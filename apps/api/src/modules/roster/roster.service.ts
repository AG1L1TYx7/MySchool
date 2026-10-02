import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type {
  RecordSource,
  RosterProvider,
  RosterSource,
  RosterSyncRun,
} from '../../generated/prisma/client';
import { newId } from '../../common/utils/ids';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { assertOrganizationAccess, isDistrictRole } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CleverClient } from './clever';
import {
  CreateRosterSourceDto,
  SsoSettingsDto,
  UpdateRosterSourceDto,
} from './dto/roster.dto';
import { OneRosterApiClient } from './oneroster-api';
import {
  bundleFromZip,
  snapshotFromBundle,
  type CsvBundle,
} from './oneroster-csv';
import type { RosterSnapshot } from './roster-model';
import { RosterSyncService, type SyncResult } from './roster-sync.service';
import { parseList, type SsoProvider } from '../sso/sso-rules';

/** UTF-8 byte-order mark some exporters prepend; stripped before parsing. */
const BOM = String.fromCharCode(0xfeff);

const SECRET_KEYS = ['clientSecret', 'districtToken'];

export interface PublicSource {
  id: string;
  organizationId: string;
  provider: string;
  name: string;
  config: Record<string, string>;
  isEnabled: boolean;
  lastRunAt: Date | null;
  lastRun: PublicRun | null;
  createdAt: Date;
}

export interface PublicRun {
  id: string;
  sourceId: string | null;
  provider: string;
  status: string;
  dryRun: boolean;
  startedAt: Date;
  finishedAt: Date | null;
  summary: SyncResult['counts'] | null;
  errorMessage: string | null;
  errorCount: number;
  errors?: Array<{
    entityType: string;
    externalId: string | null;
    message: string;
  }>;
}

const SOURCE_FOR: Record<RosterProvider, RecordSource> = {
  ONEROSTER_CSV: 'ONEROSTER',
  ONEROSTER_API: 'ONEROSTER',
  CLEVER: 'CLEVER',
  CLASSLINK: 'CLASSLINK',
};

/** Roster sources, runs and the organisation's sign-in settings (docs/13 section 2). */
@Injectable()
export class RosterService {
  private readonly logger = new Logger(RosterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: RosterSyncService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Sources
  // ---------------------------------------------------------------------------

  async listSources(
    organizationId: string,
    actor: AuthenticatedUser,
  ): Promise<PublicSource[]> {
    assertOrganizationAccess(actor, organizationId);
    const rows = await this.prisma.rosterSource.findMany({
      where: { organizationId },
      include: {
        runs: {
          orderBy: { startedAt: 'desc' },
          take: 1,
          include: { _count: { select: { errors: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) =>
      this.toPublicSource(
        r,
        r.runs[0]
          ? toPublicRun({ ...r.runs[0], errorCount: r.runs[0]._count.errors })
          : null,
      ),
    );
  }

  async createSource(
    organizationId: string,
    dto: CreateRosterSourceDto,
    actor: AuthenticatedUser,
  ): Promise<PublicSource> {
    assertOrganizationAccess(actor, organizationId);
    const provider = dto.provider.toUpperCase() as RosterProvider;
    this.validateConfig(provider, dto.config);
    const row = await this.prisma.rosterSource.create({
      data: {
        id: newId(),
        organizationId,
        provider,
        name: dto.name.trim(),
        config: this.sealConfig(dto.config),
        isEnabled: dto.isEnabled ?? true,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'roster.source.create',
      entityType: 'RosterSource',
      entityId: row.id,
      details: { provider },
    });
    return this.toPublicSource(row, null);
  }

  async updateSource(
    organizationId: string,
    id: string,
    dto: UpdateRosterSourceDto,
    actor: AuthenticatedUser,
  ): Promise<PublicSource> {
    const row = await this.findSource(organizationId, id, actor);
    const current = this.openConfig(row.config);
    const merged = dto.config
      ? {
          ...current,
          ...Object.fromEntries(
            Object.entries(dto.config).filter(
              ([k, v]) => !(SECRET_KEYS.includes(k) && v === ''),
            ),
          ),
        }
      : current;
    if (dto.config) this.validateConfig(row.provider, merged);
    const updated = await this.prisma.rosterSource.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        isEnabled: dto.isEnabled,
        config: dto.config ? this.sealConfig(merged) : undefined,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'roster.source.update',
      entityType: 'RosterSource',
      entityId: id,
      details: { fields: Object.keys(dto) },
    });
    return this.toPublicSource(updated, null);
  }

  async removeSource(
    organizationId: string,
    id: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    await this.findSource(organizationId, id, actor);
    await this.prisma.rosterSource.delete({ where: { id } });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'roster.source.delete',
      entityType: 'RosterSource',
      entityId: id,
    });
  }

  // ---------------------------------------------------------------------------
  // Runs
  // ---------------------------------------------------------------------------

  /** Starts a sync for an API source; returns the queued run, which finishes in the background. */
  async runSource(
    organizationId: string,
    id: string,
    dryRun: boolean,
    actor: AuthenticatedUser | null,
  ): Promise<PublicRun> {
    const source = actor
      ? await this.findSource(organizationId, id, actor)
      : await this.prisma.rosterSource.findFirstOrThrow({
          where: { id, organizationId },
        });
    const run = await this.prisma.rosterSyncRun.create({
      data: {
        id: newId(),
        sourceId: source.id,
        organizationId,
        provider: source.provider,
        dryRun,
        triggeredById: actor?.id ?? null,
      },
    });
    setImmediate(
      () =>
        void this.execute(run.id, source.provider, organizationId, dryRun, () =>
          this.fetchSnapshot(source),
        ),
    );
    return toPublicRun({ ...run, errorCount: 0 });
  }

  /** Imports a OneRoster CSV bundle (zip or files) uploaded by an administrator. */
  async importCsv(
    organizationId: string,
    files: Array<{ originalname: string; buffer: Buffer }>,
    dryRun: boolean,
    actor: AuthenticatedUser,
  ): Promise<PublicRun> {
    assertOrganizationAccess(actor, organizationId);
    const bundle: CsvBundle = {};
    for (const f of files) {
      const name = f.originalname.toLowerCase();
      if (name.endsWith('.zip'))
        Object.assign(bundle, bundleFromZip(new Uint8Array(f.buffer)));
      else if (name.endsWith('.csv'))
        bundle[name.split('/').pop() ?? name] = f.buffer
          .toString('utf8')
          .replace(BOM, '');
    }
    let snapshot: RosterSnapshot;
    try {
      snapshot = snapshotFromBundle(bundle);
    } catch (err) {
      throw new BadRequestException({
        code: 'roster.invalid_bundle',
        detail:
          err instanceof Error
            ? err.message
            : 'Could not read the OneRoster files.',
      });
    }
    const run = await this.prisma.rosterSyncRun.create({
      data: {
        id: newId(),
        organizationId,
        provider: 'ONEROSTER_CSV',
        dryRun,
        triggeredById: actor.id,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'roster.import',
      entityType: 'RosterSyncRun',
      entityId: run.id,
      details: {
        dryRun,
        users: snapshot.users.length,
        classes: snapshot.classes.length,
      },
    });
    setImmediate(
      () =>
        void this.execute(run.id, 'ONEROSTER_CSV', organizationId, dryRun, () =>
          Promise.resolve(snapshot),
        ),
    );
    return toPublicRun({ ...run, errorCount: 0 });
  }

  async listRuns(
    organizationId: string,
    actor: AuthenticatedUser,
  ): Promise<PublicRun[]> {
    assertOrganizationAccess(actor, organizationId);
    const rows = await this.prisma.rosterSyncRun.findMany({
      where: { organizationId },
      orderBy: { startedAt: 'desc' },
      take: 30,
      include: { _count: { select: { errors: true } } },
    });
    return rows.map((r) => toPublicRun({ ...r, errorCount: r._count.errors }));
  }

  async getRun(
    organizationId: string,
    id: string,
    actor: AuthenticatedUser,
  ): Promise<PublicRun> {
    assertOrganizationAccess(actor, organizationId);
    const row = await this.prisma.rosterSyncRun.findFirst({
      where: { id, organizationId },
      include: { errors: { take: 200 }, _count: { select: { errors: true } } },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Run not found.',
      });
    return {
      ...toPublicRun({ ...row, errorCount: row._count.errors }),
      errors: row.errors.map((e) => ({
        entityType: e.entityType,
        externalId: e.externalId,
        message: e.message,
      })),
    };
  }

  /** Nightly: every enabled API source in every active organisation. */
  @Cron('30 2 * * *')
  async nightly(): Promise<void> {
    const sources = await this.prisma.rosterSource.findMany({
      where: {
        isEnabled: true,
        provider: { not: 'ONEROSTER_CSV' },
        organization: { isActive: true, deletedAt: null },
      },
    });
    for (const s of sources) {
      try {
        await this.runSource(s.organizationId, s.id, false, null);
      } catch (err) {
        this.logger.warn(
          `Nightly roster sync could not start for ${s.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private async execute(
    runId: string,
    provider: RosterProvider,
    organizationId: string,
    dryRun: boolean,
    load: () => Promise<RosterSnapshot>,
  ): Promise<void> {
    await this.prisma.rosterSyncRun.update({
      where: { id: runId },
      data: { status: 'RUNNING' },
    });
    try {
      const snapshot = await load();
      const schoolExternalId =
        (
          await this.prisma.organization.findUnique({
            where: { id: organizationId },
            select: { externalId: true },
          })
        )?.externalId ?? null;
      const result = await this.sync.apply(
        organizationId,
        SOURCE_FOR[provider],
        snapshot,
        { dryRun, schoolExternalId },
      );
      await this.prisma.rosterSyncRun.update({
        where: { id: runId },
        data: {
          status: 'DONE',
          finishedAt: new Date(),
          summary: JSON.stringify(result.counts),
        },
      });
      if (result.errors.length)
        await this.prisma.rosterSyncError.createMany({
          data: result.errors.map((e) => ({
            id: newId(),
            runId,
            entityType: e.entityType,
            externalId: e.externalId?.slice(0, 128) ?? null,
            message: e.message.slice(0, 500),
          })),
        });
      if (!dryRun)
        await this.prisma.rosterSource.updateMany({
          where: { runs: { some: { id: runId } } },
          data: { lastRunAt: new Date() },
        });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Roster run ${runId} failed: ${message}`);
      await this.prisma.rosterSyncRun.update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorMessage: message.slice(0, 2000),
        },
      });
    }
  }

  private fetchSnapshot(source: RosterSource): Promise<RosterSnapshot> {
    const config = this.openConfig(source.config);
    if (source.provider === 'CLEVER')
      return new CleverClient({
        districtToken: config.districtToken,
        baseUrl: config.baseUrl,
        schoolExternalId: config.schoolExternalId || null,
      }).snapshot();
    if (source.provider === 'ONEROSTER_API' || source.provider === 'CLASSLINK')
      return new OneRosterApiClient({
        baseUrl: config.baseUrl,
        tokenUrl: config.tokenUrl,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        schoolExternalId: config.schoolExternalId || null,
      }).snapshot();
    throw new Error('CSV sources are imported by upload, not scheduled.');
  }

  // ---------------------------------------------------------------------------
  // Sign-in settings
  // ---------------------------------------------------------------------------

  async getSso(organizationId: string, actor: AuthenticatedUser) {
    assertOrganizationAccess(actor, organizationId);
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: {
        ssoProviders: true,
        ssoAllowedDomains: true,
        ssoPasswordOptional: true,
        externalId: true,
      },
    });
    if (!org)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Organisation not found.',
      });
    return {
      providers: parseList(org.ssoProviders) as SsoProvider[],
      allowedDomains: parseList(org.ssoAllowedDomains),
      passwordOptional: org.ssoPasswordOptional,
      schoolExternalId: org.externalId,
    };
  }

  async setSso(
    organizationId: string,
    dto: SsoSettingsDto,
    actor: AuthenticatedUser,
  ) {
    assertOrganizationAccess(actor, organizationId);
    const domains = [
      ...new Set(
        dto.allowedDomains
          .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
          .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)),
      ),
    ];
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        ssoProviders: [...new Set(dto.providers)].join(','),
        ssoAllowedDomains: domains.join(','),
        ssoPasswordOptional: dto.passwordOptional,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'organizations.sso.update',
      entityType: 'Organization',
      entityId: organizationId,
      details: { providers: dto.providers, domains },
    });
    return this.getSso(organizationId, actor);
  }

  // ---------------------------------------------------------------------------

  private async findSource(
    organizationId: string,
    id: string,
    actor: AuthenticatedUser,
  ): Promise<RosterSource> {
    if (!isDistrictRole(actor)) assertOrganizationAccess(actor, organizationId);
    const row = await this.prisma.rosterSource.findFirst({
      where: { id, organizationId },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Roster source not found.',
      });
    return row;
  }

  private validateConfig(
    provider: RosterProvider,
    config: Record<string, string>,
  ): void {
    const need =
      provider === 'CLEVER'
        ? ['districtToken']
        : ['baseUrl', 'tokenUrl', 'clientId', 'clientSecret'];
    const missing = need.filter((k) => !config[k]?.trim());
    if (missing.length)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: `Missing ${missing.join(', ')} for ${provider.toLowerCase()}.`,
      });
    for (const k of ['baseUrl', 'tokenUrl'])
      if (config[k] && !/^https?:\/\//.test(config[k]))
        throw new BadRequestException({
          code: 'request.invalid',
          detail: `${k} must be an http(s) URL.`,
        });
  }

  private sealConfig(config: Record<string, string>): string {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(config))
      out[k] =
        SECRET_KEYS.includes(k) && v ? `enc:${this.crypto.encrypt(v)}` : v;
    return JSON.stringify(out);
  }

  private openConfig(raw: string): Record<string, string> {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed))
      out[k] =
        typeof v === 'string' && v.startsWith('enc:')
          ? this.crypto.decrypt(v.slice(4))
          : v;
    return out;
  }

  private toPublicSource(
    r: RosterSource,
    lastRun: PublicRun | null,
  ): PublicSource {
    const config = JSON.parse(r.config) as Record<string, string>;
    const masked = Object.fromEntries(
      Object.entries(config).map(([k, v]) => [
        k,
        SECRET_KEYS.includes(k) ? (v ? '••••••••' : '') : v,
      ]),
    );
    return {
      id: r.id,
      organizationId: r.organizationId,
      provider: r.provider.toLowerCase(),
      name: r.name,
      config: masked,
      isEnabled: r.isEnabled,
      lastRunAt: r.lastRunAt,
      lastRun,
      createdAt: r.createdAt,
    };
  }
}

function toPublicRun(r: RosterSyncRun & { errorCount: number }): PublicRun {
  return {
    id: r.id,
    sourceId: r.sourceId,
    provider: r.provider.toLowerCase(),
    status: r.status.toLowerCase(),
    dryRun: r.dryRun,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    summary: r.summary ? (JSON.parse(r.summary) as SyncResult['counts']) : null,
    errorMessage: r.errorMessage,
    errorCount: r.errorCount,
  };
}
