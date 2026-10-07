import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { promises as dns } from 'node:dns';
import { newId } from '../../common/utils/ids';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  CreateTenantDto,
  UpdatePoliciesDto,
  UpdateTenantDto,
} from './dto/tenants.dto';
import {
  aiAllowedForSchool,
  DEFAULT_POLICIES,
  domainVerification,
  featureDisabled,
  isValidDomain,
  isValidSlug,
  parseBranding,
  parsePolicies,
  slugify,
  tenantFromHost,
  type Branding,
  type TenantPolicies,
} from './tenant-rules';

export const DEFAULT_TENANT_ID = '00000000-0000-7000-8000-000000000001';

export interface PublicTenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  customDomain: string | null;
  domainVerifiedAt: Date | null;
  verification: { name: string; value: string } | null;
  branding: Branding;
  policies: TenantPolicies;
  schools: number;
  createdAt: Date;
}

interface Cached {
  policies: TenantPolicies;
  at: number;
}

/**
 * Tenants (ADR-005): districts or hosting customers that own schools. The platform administrator creates
 * them; a superintendent manages their own district's policies and branding. Policies are cached for a
 * minute because the access guard asks on every request.
 */
@Injectable()
export class TenantsService {
  private readonly cache = new Map<string, Cached>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Policies (read on every request)
  // ---------------------------------------------------------------------------

  async policiesFor(tenantId: string | null): Promise<TenantPolicies> {
    if (!tenantId) return DEFAULT_POLICIES;
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < 60_000) return hit.policies;
    const row = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { policies: true },
    });
    const policies = parsePolicies(row?.policies);
    this.cache.set(tenantId, { policies, at: Date.now() });
    return policies;
  }

  async isFeatureDisabled(
    tenantId: string | null,
    feature: string,
  ): Promise<boolean> {
    return featureDisabled(await this.policiesFor(tenantId), feature);
  }

  /** AI for a school: the district switch first, then the school's own exclusion. */
  async aiAllowedForOrganization(organizationId: string): Promise<boolean> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { tenantId: true },
    });
    if (!org) return false;
    return aiAllowedForSchool(
      await this.policiesFor(org.tenantId),
      organizationId,
    );
  }

  async tenantIdOf(organizationId: string): Promise<string | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { tenantId: true },
    });
    return org?.tenantId ?? null;
  }

  // ---------------------------------------------------------------------------
  // Branding (public)
  // ---------------------------------------------------------------------------

  /** What the sign-in page shows for this host or slug: a name, a colour and a logo, nothing private. */
  async brandingFor(host: string | undefined, slug?: string) {
    const by = slug
      ? { slug }
      : tenantFromHost(host, this.config.get('TENANT_BASE_DOMAIN'));
    const row =
      'slug' in by
        ? await this.prisma.tenant.findFirst({
            where: { slug: by.slug, status: { not: 'suspended' } },
          })
        : 'customDomain' in by
          ? await this.prisma.tenant.findFirst({
              where: {
                customDomain: by.customDomain,
                domainVerifiedAt: { not: null },
                status: { not: 'suspended' },
              },
            })
          : await this.prisma.tenant.findUnique({
              where: { id: DEFAULT_TENANT_ID },
            });
    const branding = parseBranding(row?.branding);
    return {
      tenant: row
        ? { id: row.id, slug: row.slug, name: row.name, status: row.status }
        : null,
      displayName: branding.displayName ?? row?.name ?? 'SmartSchool',
      primaryColor: branding.primaryColor,
      logoUrl: branding.logoUrl,
      supportEmail: branding.supportEmail,
    };
  }

  // ---------------------------------------------------------------------------
  // Platform administration
  // ---------------------------------------------------------------------------

  async list(actor: AuthenticatedUser): Promise<PublicTenant[]> {
    this.platformOnly(actor);
    const rows = await this.prisma.tenant.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { organizations: true } } },
    });
    return rows.map((r) => this.toPublic(r, r._count.organizations));
  }

  async get(id: string, actor: AuthenticatedUser): Promise<PublicTenant> {
    this.canSee(id, actor);
    const row = await this.prisma.tenant.findUnique({
      where: { id },
      include: { _count: { select: { organizations: true } } },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Tenant not found.',
      });
    return this.toPublic(row, row._count.organizations);
  }

  async create(
    dto: CreateTenantDto,
    actor: AuthenticatedUser,
  ): Promise<PublicTenant> {
    this.platformOnly(actor);
    const slug = dto.slug ? dto.slug.toLowerCase() : slugify(dto.name);
    if (!isValidSlug(slug))
      throw new BadRequestException({
        code: 'request.invalid',
        detail:
          'The slug must be 3 to 63 lowercase letters, digits and dashes.',
      });
    if (await this.prisma.tenant.findUnique({ where: { slug } }))
      throw new ConflictException({
        code: 'resource.conflict',
        detail: 'That slug is taken.',
      });
    const row = await this.prisma.tenant.create({
      data: {
        id: newId(),
        name: dto.name.trim(),
        slug,
        status: dto.status ?? 'active',
        branding: dto.branding
          ? JSON.stringify(parseBranding(JSON.stringify(dto.branding)))
          : null,
      },
      include: { _count: { select: { organizations: true } } },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: null,
      action: 'tenants.create',
      entityType: 'Tenant',
      entityId: row.id,
      details: { slug },
    });
    return this.toPublic(row, 0);
  }

  async update(
    id: string,
    dto: UpdateTenantDto,
    actor: AuthenticatedUser,
  ): Promise<PublicTenant> {
    const existing = await this.prisma.tenant.findUnique({ where: { id } });
    if (!existing)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Tenant not found.',
      });
    const platform = actor.role === 'SUPER_ADMIN';
    if (!platform) {
      // A superintendent may rename and brand their own district, never change its slug, status or domain.
      if (actor.role !== 'SUPERINTENDENT' || actor.tenantId !== id)
        throw new ForbiddenException({
          code: 'authz.forbidden',
          detail: 'Not your district.',
        });
      if (
        dto.slug !== undefined ||
        dto.status !== undefined ||
        dto.customDomain !== undefined
      )
        throw new ForbiddenException({
          code: 'authz.forbidden',
          detail:
            'Only the platform administrator changes the slug, status or domain.',
        });
    }
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.slug !== undefined) {
      const slug = dto.slug.toLowerCase();
      if (!isValidSlug(slug))
        throw new BadRequestException({
          code: 'request.invalid',
          detail: 'Invalid slug.',
        });
      const taken = await this.prisma.tenant.findFirst({
        where: { slug, id: { not: id } },
      });
      if (taken)
        throw new ConflictException({
          code: 'resource.conflict',
          detail: 'That slug is taken.',
        });
      data.slug = slug;
    }
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.customDomain !== undefined) {
      const domain = dto.customDomain ? dto.customDomain.toLowerCase() : null;
      if (domain && !isValidDomain(domain))
        throw new BadRequestException({
          code: 'request.invalid',
          detail: 'Invalid domain name.',
        });
      if (domain) {
        const taken = await this.prisma.tenant.findFirst({
          where: { customDomain: domain, id: { not: id } },
        });
        if (taken)
          throw new ConflictException({
            code: 'resource.conflict',
            detail: 'That domain is attached to another tenant.',
          });
      }
      data.customDomain = domain;
      data.domainVerifiedAt = null;
      data.domainToken = domain ? newId().replace(/-/g, '') : null;
    }
    if (dto.branding !== undefined)
      data.branding = JSON.stringify(
        parseBranding(JSON.stringify(dto.branding)),
      );
    const row = await this.prisma.tenant.update({
      where: { id },
      data,
      include: { _count: { select: { organizations: true } } },
    });
    this.cache.delete(id);
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'tenants.update',
      entityType: 'Tenant',
      entityId: id,
      details: { fields: Object.keys(data) },
    });
    return this.toPublic(row, row._count.organizations);
  }

  /** Looks up the TXT record the district was asked to publish; verified only when it is there. */
  async verifyDomain(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<{
    verified: boolean;
    expected: { name: string; value: string } | null;
    found: string[];
  }> {
    this.platformOnly(actor);
    const row = await this.prisma.tenant.findUnique({ where: { id } });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Tenant not found.',
      });
    if (!row.customDomain)
      return { verified: false, expected: null, found: [] };
    const expected = domainVerification(
      row.id,
      row.customDomain,
      row.domainToken ?? '',
    );
    let found: string[] = [];
    try {
      found = (await dns.resolveTxt(expected.name)).map((parts) =>
        parts.join(''),
      );
    } catch {
      found = [];
    }
    const verified = found.includes(expected.value);
    if (verified && !row.domainVerifiedAt)
      await this.prisma.tenant.update({
        where: { id },
        data: { domainVerifiedAt: new Date() },
      });
    await this.audit.record({
      userId: actor.id,
      organizationId: null,
      action: 'tenants.domain.verify',
      entityType: 'Tenant',
      entityId: id,
      details: { domain: row.customDomain, verified },
    });
    return { verified, expected, found };
  }

  // ---------------------------------------------------------------------------
  // District policies
  // ---------------------------------------------------------------------------

  async policies(id: string, actor: AuthenticatedUser) {
    this.canSee(id, actor);
    const row = await this.prisma.tenant.findUnique({
      where: { id },
      select: { policies: true },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Tenant not found.',
      });
    return { tenantId: id, policies: parsePolicies(row.policies) };
  }

  async setPolicies(
    id: string,
    dto: UpdatePoliciesDto,
    actor: AuthenticatedUser,
  ) {
    this.canManage(id, actor);
    const current = (await this.policies(id, actor)).policies;
    const next: TenantPolicies = {
      aiEnabled: dto.aiEnabled ?? current.aiEnabled,
      aiDisabledSchools: dto.aiDisabledSchools ?? current.aiDisabledSchools,
      studentMessagingAllowed:
        dto.studentMessagingAllowed ?? current.studentMessagingAllowed,
      disabledFeatures: dto.disabledFeatures ?? current.disabledFeatures,
      retention: dto.retention ?? current.retention,
    };
    const parsed = parsePolicies(JSON.stringify(next));
    if (parsed.aiDisabledSchools.length) {
      const known = await this.prisma.organization.count({
        where: { id: { in: parsed.aiDisabledSchools }, tenantId: id },
      });
      if (known !== parsed.aiDisabledSchools.length)
        throw new BadRequestException({
          code: 'request.invalid',
          detail:
            'Every school in aiDisabledSchools must belong to this district.',
        });
    }
    await this.prisma.tenant.update({
      where: { id },
      data: { policies: JSON.stringify(parsed) },
    });
    this.cache.delete(id);
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'tenants.policies.update',
      entityType: 'Tenant',
      entityId: id,
      details: { before: current, after: parsed },
    });
    return { tenantId: id, policies: parsed };
  }

  // ---------------------------------------------------------------------------
  // Access helpers
  // ---------------------------------------------------------------------------

  private platformOnly(actor: AuthenticatedUser): void {
    if (actor.role !== 'SUPER_ADMIN')
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Platform administrators only.',
      });
  }

  private canSee(id: string, actor: AuthenticatedUser): void {
    if (actor.role === 'SUPER_ADMIN') return;
    if (actor.role === 'SUPERINTENDENT' && actor.tenantId === id) return;
    throw new ForbiddenException({
      code: 'authz.forbidden',
      detail: 'Not your district.',
    });
  }

  private canManage(id: string, actor: AuthenticatedUser): void {
    this.canSee(id, actor);
  }

  private toPublic(
    r: {
      id: string;
      name: string;
      slug: string;
      status: string;
      customDomain: string | null;
      domainToken: string | null;
      domainVerifiedAt: Date | null;
      branding: string | null;
      policies: string | null;
      createdAt: Date;
    },
    schools: number,
  ): PublicTenant {
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      status: r.status,
      customDomain: r.customDomain,
      domainVerifiedAt: r.domainVerifiedAt,
      verification: r.customDomain
        ? domainVerification(r.id, r.customDomain, r.domainToken ?? '')
        : null,
      branding: parseBranding(r.branding),
      policies: parsePolicies(r.policies),
      schools,
      createdAt: r.createdAt,
    };
  }
}
