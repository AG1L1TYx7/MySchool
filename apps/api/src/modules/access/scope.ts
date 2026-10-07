import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Organisation scoping (ADR-019) inside tenants (ADR-005). SuperAdmin runs the platform and sees every
 * organisation. A superintendent sees every organisation of their own tenant (the district) and may narrow
 * with a requested id. Everyone else is confined to their own organisation. A user without an organisation
 * sees nothing rather than everything.
 */
export function isDistrictRole(actor: AuthenticatedUser): boolean {
  return actor.role === 'SUPER_ADMIN' || actor.role === 'SUPERINTENDENT';
}

/** Organisations the actor may reach without naming one: the tenant's for a superintendent, their own otherwise. */
export function reachableOrganizationIds(
  actor: AuthenticatedUser,
): string[] | 'all' {
  if (actor.role === 'SUPER_ADMIN') return 'all';
  if (actor.role === 'SUPERINTENDENT') return actor.tenantOrganizationIds ?? [];
  return actor.organizationId ? [actor.organizationId] : [];
}

export function organizationScope(
  actor: AuthenticatedUser,
  requested?: string,
): { organizationId?: string | { in: string[] } } {
  if (actor.role === 'SUPER_ADMIN')
    return requested ? { organizationId: requested } : {};
  if (actor.role === 'SUPERINTENDENT') {
    const ids = actor.tenantOrganizationIds ?? [];
    if (requested) {
      assertOrganizationAccess(actor, requested);
      return { organizationId: requested };
    }
    return { organizationId: { in: ids } };
  }
  return { organizationId: actor.organizationId ?? '__none__' };
}

/** The organisation a new record belongs to: the requested one for district roles, the actor's otherwise. */
export function resolveOrganizationId(
  actor: AuthenticatedUser,
  requested?: string,
): string {
  if (isDistrictRole(actor)) {
    if (!requested)
      throw new ForbiddenException({
        code: 'request.invalid',
        detail: 'organizationId is required for district-level accounts.',
      });
    assertOrganizationAccess(actor, requested);
    return requested;
  }
  if (!actor.organizationId)
    throw new ForbiddenException({
      code: 'authz.forbidden',
      detail: 'Your account is not attached to an organisation.',
    });
  return actor.organizationId;
}

export function assertOrganizationAccess(
  actor: AuthenticatedUser,
  organizationId: string,
): void {
  if (actor.role === 'SUPER_ADMIN') return;
  if (actor.role === 'SUPERINTENDENT') {
    if ((actor.tenantOrganizationIds ?? []).includes(organizationId)) return;
    throw new ForbiddenException({
      code: 'authz.forbidden',
      detail: 'This school belongs to another district.',
    });
  }
  if (actor.organizationId !== organizationId) {
    throw new ForbiddenException({
      code: 'authz.forbidden',
      detail: 'This record belongs to another organisation.',
    });
  }
}
