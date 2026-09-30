import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Organisation scoping (ADR-019). District roles (SuperAdmin, Superintendent) see every
 * organisation and may narrow with a requested id; everyone else is confined to their own.
 * A user without an organisation sees nothing rather than everything.
 */
export function isDistrictRole(actor: AuthenticatedUser): boolean {
  return actor.role === 'SUPER_ADMIN' || actor.role === 'SUPERINTENDENT';
}

export function organizationScope(
  actor: AuthenticatedUser,
  requested?: string,
): { organizationId?: string } {
  if (isDistrictRole(actor))
    return requested ? { organizationId: requested } : {};
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
  if (isDistrictRole(actor)) return;
  if (actor.organizationId !== organizationId) {
    throw new ForbiddenException({
      code: 'authz.forbidden',
      detail: 'This record belongs to another organisation.',
    });
  }
}
