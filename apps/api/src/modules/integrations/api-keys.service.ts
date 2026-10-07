import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { newId } from '../../common/utils/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { assertOrganizationAccess } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateApiKeyDto } from './dto/integrations.dto';
import {
  API_KEY_SCOPES,
  apiKeyMatches,
  generateApiKey,
  parseApiKey,
  parseScopes,
  takeRateToken,
  type RateWindow,
} from './integration-rules';

/**
 * API keys for district integrations: a key acts with the authority of the administrator who created it,
 * limited to read and export scopes and a per-minute budget. Presented as X-Api-Key; the hash is stored.
 */
@Injectable()
export class ApiKeysService {
  private readonly windows = new Map<string, RateWindow>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, actor: AuthenticatedUser) {
    assertOrganizationAccess(actor, organizationId);
    const rows = await this.prisma.apiKey.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { firstName: true, lastName: true } } },
    });
    return rows.map((r) => this.toPublic(r));
  }

  async create(
    organizationId: string,
    dto: CreateApiKeyDto,
    actor: AuthenticatedUser,
  ) {
    assertOrganizationAccess(actor, organizationId);
    const key = generateApiKey();
    const row = await this.prisma.apiKey.create({
      data: {
        id: newId(),
        organizationId,
        name: dto.name,
        prefix: key.prefix,
        keyHash: key.hash,
        scopes: JSON.stringify(
          dto.scopes.filter((s) =>
            (API_KEY_SCOPES as readonly string[]).includes(s),
          ),
        ),
        rateLimitPerMinute: dto.rateLimitPerMinute ?? 600,
        createdById: actor.id,
        expiresAt: dto.expiresInDays
          ? new Date(Date.now() + dto.expiresInDays * 86_400_000)
          : null,
      },
      include: { createdBy: { select: { firstName: true, lastName: true } } },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'api_keys.create',
      entityType: 'ApiKey',
      entityId: row.id,
      details: { name: dto.name, scopes: dto.scopes },
    });
    // The key is shown exactly once.
    return { ...this.toPublic(row), key: key.plain };
  }

  async revoke(organizationId: string, id: string, actor: AuthenticatedUser) {
    assertOrganizationAccess(actor, organizationId);
    const row = await this.prisma.apiKey.findFirst({
      where: { id, organizationId },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'API key not found.',
      });
    const updated = await this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: row.revokedAt ?? new Date() },
      include: { createdBy: { select: { firstName: true, lastName: true } } },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'api_keys.revoke',
      entityType: 'ApiKey',
      entityId: id,
    });
    return this.toPublic(updated);
  }

  scopes(): readonly string[] {
    return API_KEY_SCOPES;
  }

  /**
   * Turns a presented key into the principal the request runs as: the creator's identity, the key's
   * organisation, PRINCIPAL-level data access, and the key's scopes as the only features it may use.
   */
  async authenticate(
    presented: string | undefined,
  ): Promise<AuthenticatedUser> {
    const parsed = parseApiKey(presented);
    if (!parsed)
      throw new UnauthorizedException({
        code: 'auth.api_key_invalid',
        detail: 'The API key is not valid.',
      });
    const row = await this.prisma.apiKey.findUnique({
      where: { prefix: parsed.prefix },
      include: {
        createdBy: {
          select: {
            id: true,
            email: true,
            status: true,
            deletedAt: true,
            organizationId: true,
          },
        },
        organization: {
          select: { tenantId: true, isActive: true, deletedAt: true },
        },
      },
    });
    if (!row || !apiKeyMatches(parsed.plain, row.keyHash))
      throw new UnauthorizedException({
        code: 'auth.api_key_invalid',
        detail: 'The API key is not valid.',
      });
    const now = new Date();
    if (row.revokedAt || (row.expiresAt && row.expiresAt <= now))
      throw new UnauthorizedException({
        code: 'auth.api_key_revoked',
        detail: 'This API key has been revoked or has expired.',
      });
    if (
      row.createdBy.deletedAt ||
      row.createdBy.status !== 'ACTIVE' ||
      !row.organization.isActive ||
      row.organization.deletedAt
    )
      throw new UnauthorizedException({
        code: 'auth.api_key_revoked',
        detail: 'The account behind this API key is no longer active.',
      });
    const taken = takeRateToken(
      this.windows.get(row.id),
      row.rateLimitPerMinute,
      now,
    );
    this.windows.set(row.id, taken.window);
    if (!taken.allowed)
      throw new HttpException(
        {
          code: 'rate_limited',
          detail: `This API key may make ${row.rateLimitPerMinute} requests per minute.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60_000) {
      await this.prisma.apiKey
        .update({ where: { id: row.id }, data: { lastUsedAt: now } })
        .catch(() => undefined);
    }
    return {
      id: row.createdById,
      email: row.createdBy.email,
      role: 'PRINCIPAL',
      organizationId: row.organizationId,
      tenantId: row.organization.tenantId,
      sessionId: `apikey:${row.id}`,
      mfaSetupRequired: false,
      apiKey: { id: row.id, name: row.name, scopes: parseScopes(row.scopes) },
    };
  }

  private toPublic(r: {
    id: string;
    organizationId: string;
    name: string;
    prefix: string;
    scopes: string;
    rateLimitPerMinute: number;
    createdById: string;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
    createdBy: { firstName: string; lastName: string };
  }) {
    return {
      id: r.id,
      organizationId: r.organizationId,
      name: r.name,
      prefix: r.prefix,
      scopes: parseScopes(r.scopes),
      rateLimitPerMinute: r.rateLimitPerMinute,
      createdBy: `${r.createdBy.firstName} ${r.createdBy.lastName}`.trim(),
      createdById: r.createdById,
      lastUsedAt: r.lastUsedAt,
      expiresAt: r.expiresAt,
      revokedAt: r.revokedAt,
      createdAt: r.createdAt,
    };
  }
}
