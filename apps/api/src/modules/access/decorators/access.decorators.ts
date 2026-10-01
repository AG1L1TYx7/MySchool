import { SetMetadata } from '@nestjs/common';
import type { Role } from '../../../generated/prisma/client';

export const ROLES_KEY = 'access:roles';
export const MIN_ROLE_LEVEL_KEY = 'access:minRoleLevel';
export const REQUIRE_FEATURE_KEY = 'access:requireFeature';
export const FEATURE_GATE_KEY = 'access:featureGate';

/** Allow only the listed roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Allow roles at or above a hierarchy level (docs/01 section 2): 3 = teacher or above. */
export const MinRole = (level: number) =>
  SetMetadata(MIN_ROLE_LEVEL_KEY, level);

/** Require every listed feature code in the caller's effective feature set. */
export const RequireFeature = (...codes: string[]) =>
  SetMetadata(REQUIRE_FEATURE_KEY, codes);

/** Hide the route (404) unless the named feature flag is enabled. */
export const FeatureGate = (flag: string) =>
  SetMetadata(FEATURE_GATE_KEY, flag);
