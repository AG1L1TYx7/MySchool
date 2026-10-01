import { SetMetadata } from '@nestjs/common';
import type { Role } from '../../../generated/prisma/client';

export const ROLES_KEY = 'access:roles';
export const MIN_ROLE_LEVEL_KEY = 'access:minRoleLevel';
export const REQUIRE_FEATURE_KEY = 'access:requireFeature';
export const REQUIRE_ANY_FEATURE_KEY = 'access:requireAnyFeature';
export const FEATURE_GATE_KEY = 'access:featureGate';

/** Allow only the listed roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Allow roles at or above a hierarchy level (docs/01 section 2): 3 = teacher or above. */
export const MinRole = (level: number) =>
  SetMetadata(MIN_ROLE_LEVEL_KEY, level);

/** Require every listed feature code in the caller's effective feature set. */
export const RequireFeature = (...codes: string[]) =>
  SetMetadata(REQUIRE_FEATURE_KEY, codes);

/**
 * Require at least one of the listed feature codes. Used where the same route serves
 * different audiences (grades.view.all for staff, grades.view.own for students, grades.view.child
 * for parents); the service then narrows the data to what that audience may see.
 */
export const RequireAnyFeature = (...codes: string[]) =>
  SetMetadata(REQUIRE_ANY_FEATURE_KEY, codes);

/** Hide the route (404) unless the named feature flag is enabled. */
export const FeatureGate = (flag: string) =>
  SetMetadata(FEATURE_GATE_KEY, flag);
