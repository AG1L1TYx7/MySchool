import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import argon2 from 'argon2';
import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign as cryptoSign,
  timingSafeEqual,
  verify as cryptoVerify,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto';
import { newId } from '../../common/utils/ids';
import { AppConfigService } from '../../config/app-config.service';
import type { Role, User } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { assertOrganizationAccess, isDistrictRole } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import {
  AuthService,
  type LoginResult,
  type RequestContext,
} from '../auth/auth.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  CreateLtiPlatformDto,
  CreateLtiToolDto,
  UpdateLtiPlatformDto,
  UpdateLtiToolDto,
} from './dto/integrations.dto';
import {
  autoPostForm,
  base64url,
  checkLaunchClaims,
  launchPathFor,
  LTI_CLAIM,
  platformLaunchClaims,
  roleFromLtiRoles,
  toolConfiguration,
  type LaunchClaims,
} from './integration-rules';

export class LtiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const STATE_TTL_MS = 10 * 60_000;
const JWKS_TTL_MS = 60 * 60_000;

/**
 * LTI 1.3 (IMS Core 1.3 + Security Framework): SmartSchool as a tool launched from Canvas or Schoology,
 * and as a platform launching external tools from a class. Signing uses one RSA key kept in LtiKeys.
 */
@Injectable()
export class LtiService {
  private readonly log = new Logger(LtiService.name);
  private key: {
    kid: string;
    privateKey: KeyObject;
    publicJwk: JsonWebKey;
  } | null = null;
  private readonly jwksCache = new Map<
    string,
    { fetchedAt: number; keys: JsonWebKey[] }
  >();
  private readonly usedNonces = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly auth: AuthService,
  ) {}

  // ---------------------------------------------------------------------------
  // Keys
  // ---------------------------------------------------------------------------

  async jwks(): Promise<{ keys: JsonWebKey[] }> {
    const k = await this.signingKey();
    return { keys: [k.publicJwk] };
  }

  private async signingKey() {
    if (this.key) return this.key;
    let row = await this.prisma.ltiKey.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    if (!row) {
      const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const kid = randomBytes(8).toString('hex');
      const jwk = {
        ...pair.publicKey.export({ format: 'jwk' }),
        kid,
        alg: 'RS256',
        use: 'sig',
      };
      row = await this.prisma.ltiKey.create({
        data: {
          id: newId(),
          kid,
          privatePem: pair.privateKey.export({
            type: 'pkcs8',
            format: 'pem',
          }) as string,
          publicJwk: JSON.stringify(jwk),
        },
      });
    }
    this.key = {
      kid: row.kid,
      privateKey: createPrivateKey(row.privatePem),
      publicJwk: JSON.parse(row.publicJwk) as JsonWebKey,
    };
    return this.key;
  }

  async signIdToken(claims: Record<string, unknown>): Promise<string> {
    const k = await this.signingKey();
    const header = base64url(
      JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: k.kid }),
    );
    const body = base64url(JSON.stringify(claims));
    const signature = cryptoSign(
      'sha256',
      Buffer.from(`${header}.${body}`),
      k.privateKey,
    );
    return `${header}.${body}.${base64url(signature)}`;
  }

  /** Verifies an RS256 id_token against a platform's JWKS (fetched and cached; refetched once on an unknown kid). */
  private async verifyIdToken(
    token: string,
    jwksUrl: string,
  ): Promise<LaunchClaims> {
    const parts = token.split('.');
    if (parts.length !== 3)
      throw new LtiError('token', 'The id_token is malformed.');
    const header = JSON.parse(
      Buffer.from(parts[0], 'base64url').toString('utf8'),
    ) as { alg?: string; kid?: string };
    if (header.alg !== 'RS256')
      throw new LtiError('token', 'Only RS256 id_tokens are accepted.');
    let jwk = await this.platformKey(jwksUrl, header.kid, false);
    if (!jwk) jwk = await this.platformKey(jwksUrl, header.kid, true);
    if (!jwk)
      throw new LtiError(
        'key',
        'The platform did not publish the key that signed this launch.',
      );
    const ok = cryptoVerify(
      'sha256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      createPublicKey({ key: jwk, format: 'jwk' }),
      Buffer.from(parts[2], 'base64url'),
    );
    if (!ok)
      throw new LtiError('signature', 'The launch signature is not valid.');
    return JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as LaunchClaims;
  }

  private async platformKey(
    jwksUrl: string,
    kid: string | undefined,
    refresh: boolean,
  ): Promise<JsonWebKey | null> {
    const cached = this.jwksCache.get(jwksUrl);
    if (!cached || refresh || Date.now() - cached.fetchedAt > JWKS_TTL_MS) {
      const res = await fetch(jwksUrl, {
        signal: AbortSignal.timeout(8000),
        headers: { accept: 'application/json' },
      });
      if (!res.ok)
        throw new LtiError(
          'jwks',
          `The platform's key set could not be read (HTTP ${res.status}).`,
        );
      const body = (await res.json()) as { keys?: JsonWebKey[] };
      this.jwksCache.set(jwksUrl, {
        fetchedAt: Date.now(),
        keys: body.keys ?? [],
      });
    }
    const keys = this.jwksCache.get(jwksUrl)?.keys ?? [];
    return (kid ? keys.find((k) => k.kid === kid) : keys[0]) ?? null;
  }

  // ---------------------------------------------------------------------------
  // SmartSchool as a tool
  // ---------------------------------------------------------------------------

  async configuration(organizationId: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: { name: true },
    });
    if (!org)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Organisation not found.',
      });
    return toolConfiguration(
      this.config.get('API_PUBLIC_URL'),
      this.config.get('WEB_APP_URL'),
      org.name,
    );
  }

  /** OIDC login initiation: answer with the platform's authorization redirect and the state to keep in a cookie. */
  async loginInit(
    params: Record<string, string | undefined>,
  ): Promise<{ redirectUrl: string; state: string }> {
    const iss = params.iss;
    const loginHint = params.login_hint;
    const target = params.target_link_uri;
    if (!iss || !loginHint || !target)
      throw new LtiError(
        'params',
        'iss, login_hint and target_link_uri are required.',
      );
    const platform = await this.prisma.ltiPlatform.findFirst({
      where: {
        issuer: iss,
        isActive: true,
        ...(params.client_id ? { clientId: params.client_id } : {}),
      },
    });
    if (!platform)
      throw new LtiError(
        'unknown_platform',
        'This platform is not registered with SmartSchool.',
      );
    const nonce = randomBytes(16).toString('hex');
    const state = this.signState({
      p: platform.id,
      n: nonce,
      t: target,
      exp: Date.now() + STATE_TTL_MS,
    });
    const url = new URL(platform.authorizationUrl);
    const q = url.searchParams;
    q.set('scope', 'openid');
    q.set('response_type', 'id_token');
    q.set('response_mode', 'form_post');
    q.set('prompt', 'none');
    q.set('client_id', platform.clientId);
    q.set('redirect_uri', `${this.apiBase()}/api/v1/lti/launch`);
    q.set('login_hint', loginHint);
    q.set('state', state);
    q.set('nonce', nonce);
    if (params.lti_message_hint)
      q.set('lti_message_hint', params.lti_message_hint);
    return { redirectUrl: url.toString(), state };
  }

  /** The launch: verify state and id_token, find or create the person, open a session, say where to land. */
  async launch(
    idToken: string | undefined,
    state: string | undefined,
    stateCookie: string | undefined,
    ctx: RequestContext,
  ): Promise<{ result: LoginResult; next: string; user: User }> {
    if (!idToken || !state)
      throw new LtiError('params', 'id_token and state are required.');
    if (!stateCookie || !this.constantEqual(state, stateCookie))
      throw new LtiError('state', 'The launch did not start in this browser.');
    const raw = this.verifyState(state);
    if (
      !raw ||
      typeof raw.p !== 'string' ||
      typeof raw.n !== 'string' ||
      typeof raw.t !== 'string'
    )
      throw new LtiError(
        'state',
        'The launch state is not valid or has expired.',
      );
    const payload = { p: raw.p, n: raw.n, t: raw.t };
    const platform = await this.prisma.ltiPlatform.findFirst({
      where: { id: payload.p, isActive: true },
    });
    if (!platform)
      throw new LtiError(
        'unknown_platform',
        'This platform is not registered with SmartSchool.',
      );
    const claims = await this.verifyIdToken(idToken, platform.jwksUrl);
    const check = checkLaunchClaims(
      claims,
      {
        issuer: platform.issuer,
        clientId: platform.clientId,
        nonce: payload.n,
        deploymentId: platform.deploymentId,
      },
      new Date(),
    );
    if (!check.ok)
      throw new LtiError(
        `claims_${check.reason}`,
        `The launch was refused (${check.reason}).`,
      );
    if (!this.takeNonce(payload.n))
      throw new LtiError('replay', 'This launch was already used.');
    const user = await this.resolveToolUser(
      platform.id,
      platform.organizationId,
      claims.sub,
      check,
    );
    const result = await this.auth.loginWithIdentity(user, 'lti', ctx);
    await this.audit.record({
      userId: user.id,
      organizationId: platform.organizationId,
      action: 'auth.lti.launch',
      entityType: 'LtiPlatform',
      entityId: platform.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      details: { context: check.context, roles: check.roles },
    });
    const custom = claims[`${LTI_CLAIM}custom`] as
      Record<string, unknown> | undefined;
    return {
      result,
      next: launchPathFor(
        check.targetLinkUri ?? payload.t,
        this.apiBase(),
        custom,
      ),
      user,
    };
  }

  private async resolveToolUser(
    platformId: string,
    organizationId: string,
    subject: string,
    check: ReturnType<typeof checkLaunchClaims>,
  ): Promise<User> {
    const link = await this.prisma.ltiUserLink.findUnique({
      where: { platformId_subject: { platformId, subject } },
      include: { user: true },
    });
    if (link) {
      if (link.user.deletedAt || link.user.status !== 'ACTIVE')
        throw new LtiError('disabled', 'This account is not active.');
      return link.user;
    }
    let user = check.email
      ? await this.prisma.user.findFirst({
          where: { email: check.email, deletedAt: null },
        })
      : null;
    if (
      user &&
      user.organizationId !== organizationId &&
      !isDistrictRole({ role: user.role } as AuthenticatedUser)
    )
      throw new LtiError(
        'wrong_school',
        'This email belongs to an account at another school.',
      );
    if (!user) {
      const role: Role = roleFromLtiRoles(check.roles);
      const email =
        check.email ??
        `lti-${createHash('sha256').update(`${platformId}:${subject}`).digest('hex').slice(0, 24)}@lti.invalid`;
      user = await this.prisma.user.create({
        data: {
          id: newId(),
          email,
          passwordHash: await argon2.hash(randomBytes(32).toString('hex'), {
            type: argon2.argon2id,
            memoryCost: 19_456,
            timeCost: 2,
            parallelism: 1,
          }),
          passwordChangedAt: new Date(),
          firstName: check.name.given || 'LTI',
          lastName: check.name.family || 'User',
          role,
          organizationId,
          emailVerifiedAt: new Date(),
        },
      });
      if (role === 'STUDENT') {
        await this.prisma.student
          .create({
            data: {
              id: newId(),
              organizationId,
              userId: user.id,
              studentNumber: `LTI-${subject.replace(/[^A-Za-z0-9]/g, '').slice(0, 40) || user.id.slice(0, 8)}`,
              firstName: user.firstName,
              lastName: user.lastName,
              enrollmentStatus: 'ACTIVE',
            },
          })
          .catch((err: Error) =>
            this.log.warn(
              `student row for LTI user not created: ${err.message}`,
            ),
          );
      }
      await this.audit.record({
        userId: user.id,
        organizationId,
        action: 'auth.lti.user_created',
        entityType: 'User',
        entityId: user.id,
        details: { role, platformId },
      });
    } else if (user.status !== 'ACTIVE') {
      throw new LtiError('disabled', 'This account is not active.');
    }
    await this.prisma.ltiUserLink.create({
      data: { id: newId(), platformId, subject, userId: user.id },
    });
    return user;
  }

  // ---------------------------------------------------------------------------
  // Platforms and tools (administration)
  // ---------------------------------------------------------------------------

  async listPlatforms(organizationId: string, actor: AuthenticatedUser) {
    assertOrganizationAccess(actor, organizationId);
    return this.prisma.ltiPlatform.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createPlatform(
    organizationId: string,
    dto: CreateLtiPlatformDto,
    actor: AuthenticatedUser,
  ) {
    assertOrganizationAccess(actor, organizationId);
    const row = await this.prisma.ltiPlatform.create({
      data: {
        id: newId(),
        organizationId,
        name: dto.name,
        issuer: dto.issuer.replace(/\/$/, ''),
        clientId: dto.clientId,
        deploymentId: dto.deploymentId ?? null,
        authorizationUrl: dto.authorizationUrl,
        jwksUrl: dto.jwksUrl,
        tokenUrl: dto.tokenUrl ?? null,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'lti.platform.create',
      entityType: 'LtiPlatform',
      entityId: row.id,
      details: { issuer: row.issuer },
    });
    return row;
  }

  async updatePlatform(
    organizationId: string,
    id: string,
    dto: UpdateLtiPlatformDto,
    actor: AuthenticatedUser,
  ) {
    assertOrganizationAccess(actor, organizationId);
    await this.ownPlatform(organizationId, id);
    const row = await this.prisma.ltiPlatform.update({
      where: { id },
      data: { ...dto },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'lti.platform.update',
      entityType: 'LtiPlatform',
      entityId: id,
      details: { fields: Object.keys(dto) },
    });
    return row;
  }

  async removePlatform(
    organizationId: string,
    id: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    assertOrganizationAccess(actor, organizationId);
    await this.ownPlatform(organizationId, id);
    await this.prisma.ltiPlatform.delete({ where: { id } });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'lti.platform.delete',
      entityType: 'LtiPlatform',
      entityId: id,
    });
  }

  /** What an administrator pastes into the external tool: our issuer, auth endpoint, JWKS, their client id and deployment id. */
  platformDetails(tool: { clientId: string; deploymentId: string }) {
    const base = this.apiBase();
    return {
      issuer: base,
      authorizationUrl: `${base}/api/v1/lti/platform/auth`,
      jwksUrl: `${base}/api/v1/lti/jwks`,
      clientId: tool.clientId,
      deploymentId: tool.deploymentId,
    };
  }

  async listTools(organizationId: string, actor: AuthenticatedUser) {
    assertOrganizationAccess(actor, organizationId);
    const rows = await this.prisma.ltiTool.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((t) => this.toPublicTool(t));
  }

  async createTool(
    organizationId: string,
    dto: CreateLtiToolDto,
    actor: AuthenticatedUser,
  ) {
    assertOrganizationAccess(actor, organizationId);
    const row = await this.prisma.ltiTool.create({
      data: {
        id: newId(),
        organizationId,
        name: dto.name,
        clientId: `tool_${randomBytes(12).toString('hex')}`,
        deploymentId: `dep_${randomBytes(6).toString('hex')}`,
        loginUrl: dto.loginUrl,
        launchUrl: dto.launchUrl,
        jwksUrl: dto.jwksUrl ?? null,
        customParams: dto.customParams
          ? JSON.stringify(dto.customParams)
          : null,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'lti.tool.create',
      entityType: 'LtiTool',
      entityId: row.id,
      details: { launchUrl: row.launchUrl },
    });
    return this.toPublicTool(row);
  }

  async updateTool(
    organizationId: string,
    id: string,
    dto: UpdateLtiToolDto,
    actor: AuthenticatedUser,
  ) {
    assertOrganizationAccess(actor, organizationId);
    await this.ownTool(organizationId, id);
    const { customParams, ...rest } = dto;
    const row = await this.prisma.ltiTool.update({
      where: { id },
      data: {
        ...rest,
        ...(customParams !== undefined
          ? { customParams: JSON.stringify(customParams) }
          : {}),
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'lti.tool.update',
      entityType: 'LtiTool',
      entityId: id,
      details: { fields: Object.keys(dto) },
    });
    return this.toPublicTool(row);
  }

  async removeTool(
    organizationId: string,
    id: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    assertOrganizationAccess(actor, organizationId);
    await this.ownTool(organizationId, id);
    await this.prisma.ltiTool.delete({ where: { id } });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'lti.tool.delete',
      entityType: 'LtiTool',
      entityId: id,
    });
  }

  /** Tools a person in a class may open: every active tool of the class's school. */
  async toolsForClass(classId: string, actor: AuthenticatedUser) {
    const klass = await this.prisma.class.findFirst({
      where: { id: classId, deletedAt: null },
      select: { organizationId: true },
    });
    if (!klass)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Class not found.',
      });
    if (!isDistrictRole(actor))
      assertOrganizationAccess(actor, klass.organizationId);
    const rows = await this.prisma.ltiTool.findMany({
      where: { organizationId: klass.organizationId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    return rows;
  }

  /** Step one of launching a tool: an HTML page that posts the OIDC login initiation to the tool. */
  async launchTool(
    organizationId: string,
    toolId: string,
    classId: string | undefined,
    actor: AuthenticatedUser,
  ): Promise<string> {
    assertOrganizationAccess(actor, organizationId);
    const tool = await this.ownTool(organizationId, toolId);
    if (!tool.isActive)
      throw new ForbiddenException({
        code: 'lti.tool_inactive',
        detail: 'This tool is switched off.',
      });
    if (classId) {
      const klass = await this.prisma.class.findFirst({
        where: { id: classId, organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!klass)
        throw new NotFoundException({
          code: 'resource.not_found',
          detail: 'Class not found.',
        });
    }
    const hint = this.signState({
      tool: tool.id,
      c: classId ?? null,
      u: actor.id,
      exp: Date.now() + STATE_TTL_MS,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'lti.tool.launch',
      entityType: 'LtiTool',
      entityId: tool.id,
      details: { classId: classId ?? null },
    });
    return autoPostForm(tool.loginUrl, {
      iss: this.apiBase(),
      login_hint: actor.id,
      target_link_uri: tool.launchUrl,
      lti_message_hint: hint,
      client_id: tool.clientId,
      lti_deployment_id: tool.deploymentId,
    });
  }

  /** Step two: the tool's OIDC request comes back; answer with a signed id_token posted to its redirect_uri. */
  async platformAuth(
    params: Record<string, string | undefined>,
  ): Promise<string> {
    const hint = params.lti_message_hint
      ? this.verifyState(params.lti_message_hint)
      : null;
    if (!hint || typeof hint.tool !== 'string' || typeof hint.u !== 'string')
      throw new LtiError(
        'hint',
        'The launch has expired. Open the tool again from SmartSchool.',
      );
    if (
      params.scope !== 'openid' ||
      params.response_type !== 'id_token' ||
      !params.redirect_uri ||
      !params.nonce ||
      !params.client_id
    )
      throw new LtiError(
        'params',
        'The tool sent an incomplete authentication request.',
      );
    const tool = await this.prisma.ltiTool.findFirst({
      where: { id: hint.tool, isActive: true },
    });
    if (!tool || tool.clientId !== params.client_id)
      throw new LtiError('client', 'Unknown client.');
    if (params.login_hint && params.login_hint !== hint.u)
      throw new LtiError('hint', 'The login hint does not match the launch.');
    const allowed = new URL(tool.launchUrl);
    const redirect = new URL(params.redirect_uri);
    if (
      redirect.origin !== allowed.origin ||
      !redirect.pathname.startsWith(allowed.pathname)
    )
      throw new LtiError(
        'redirect',
        'The tool asked for a redirect we do not know.',
      );
    const user = await this.prisma.user.findFirst({
      where: { id: hint.u, deletedAt: null, status: 'ACTIVE' },
    });
    if (!user)
      throw new LtiError('user', 'The person launching is not active.');
    const klass =
      typeof hint.c === 'string'
        ? await this.prisma.class.findFirst({
            where: { id: hint.c, deletedAt: null },
            select: { id: true, name: true, section: true },
          })
        : null;
    const custom = {
      ...(tool.customParams
        ? (JSON.parse(tool.customParams) as Record<string, string>)
        : {}),
      smartschool_user_id: user.id,
      ...(klass ? { smartschool_class_id: klass.id } : {}),
    };
    const claims = platformLaunchClaims({
      issuer: this.apiBase(),
      clientId: tool.clientId,
      deploymentId: tool.deploymentId,
      nonce: params.nonce,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      targetLinkUri: tool.launchUrl,
      resourceLinkId: klass ? `${tool.id}:${klass.id}` : tool.id,
      context: klass
        ? {
            id: klass.id,
            title: klass.name,
            label: klass.section ?? klass.name,
          }
        : null,
      custom,
      now: new Date(),
    });
    const idToken = await this.signIdToken(claims);
    return autoPostForm(params.redirect_uri, {
      id_token: idToken,
      ...(params.state ? { state: params.state } : {}),
    });
  }

  // ---------------------------------------------------------------------------

  private async ownPlatform(organizationId: string, id: string) {
    const row = await this.prisma.ltiPlatform.findFirst({
      where: { id, organizationId },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Platform not found.',
      });
    return row;
  }

  private async ownTool(organizationId: string, id: string) {
    const row = await this.prisma.ltiTool.findFirst({
      where: { id, organizationId },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Tool not found.',
      });
    return row;
  }

  private toPublicTool(t: {
    id: string;
    organizationId: string;
    name: string;
    clientId: string;
    deploymentId: string;
    loginUrl: string;
    launchUrl: string;
    jwksUrl: string | null;
    customParams: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: t.id,
      organizationId: t.organizationId,
      name: t.name,
      loginUrl: t.loginUrl,
      launchUrl: t.launchUrl,
      jwksUrl: t.jwksUrl,
      customParams: t.customParams
        ? (JSON.parse(t.customParams) as Record<string, string>)
        : {},
      isActive: t.isActive,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      platform: this.platformDetails(t),
    };
  }

  private apiBase(): string {
    return this.config.get('API_PUBLIC_URL').replace(/\/$/, '');
  }

  /** HMAC-signed, time-limited state for both directions of a launch. */
  private signState(payload: Record<string, unknown>): string {
    const body = base64url(JSON.stringify(payload));
    const sig = createHmac('sha256', this.config.get('JWT_SECRET'))
      .update(body)
      .digest('base64url');
    return `${body}.${sig}`;
  }

  private verifyState(state: string): Record<string, unknown> | null {
    const [body, sig] = state.split('.');
    if (!body || !sig) return null;
    const expected = createHmac('sha256', this.config.get('JWT_SECRET'))
      .update(body)
      .digest('base64url');
    if (!this.constantEqual(sig, expected)) return null;
    try {
      const payload = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
      if (typeof payload.exp !== 'number' || payload.exp < Date.now())
        return null;
      return payload;
    } catch {
      return null;
    }
  }

  private constantEqual(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }

  private takeNonce(nonce: string): boolean {
    const now = Date.now();
    for (const [n, exp] of this.usedNonces)
      if (exp < now) this.usedNonces.delete(n);
    if (this.usedNonces.has(nonce)) return false;
    this.usedNonces.set(nonce, now + STATE_TTL_MS);
    return true;
  }

  /** Used by the controller to turn an LtiError into a sign-in page message. */
  static isLtiError(err: unknown): err is LtiError {
    return err instanceof LtiError;
  }

  assertNever(): never {
    throw new BadRequestException({
      code: 'request.invalid',
      detail: 'Unsupported.',
    });
  }
}
