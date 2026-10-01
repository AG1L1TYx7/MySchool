import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Role } from '../../../generated/prisma/client';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { FeatureFlagService } from '../feature-flag.service';
import { hasMinimumLevel } from '../roles';
import {
  FEATURE_GATE_KEY,
  MIN_ROLE_LEVEL_KEY,
  REQUIRE_ANY_FEATURE_KEY,
  REQUIRE_FEATURE_KEY,
  ROLES_KEY,
} from '../decorators/access.decorators';
import { PermissionService } from '../permission.service';

/**
 * Runs after JWT authentication. Applies, in order: feature flag gate (404 when off),
 * mandatory two-factor setup for privileged roles (403 everywhere except the auth routes),
 * role allowlist, minimum role level, required feature codes (403 with the missing code).
 * Ownership checks stay in services (docs/01 section 4.1).
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionService,
    private readonly flags: FeatureFlagService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const gate = this.reflector.getAllAndOverride<string | undefined>(
      FEATURE_GATE_KEY,
      targets,
    );
    if (gate && !(await this.flags.isEnabled(gate))) {
      throw new NotFoundException({
        code: 'feature.disabled',
        detail: `Feature '${gate}' is currently disabled.`,
      });
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      targets,
    );
    if (isPublic) return true;

    const user = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>().user;
    if (
      user?.mfaSetupRequired &&
      context.getClass().name !== 'AuthController'
    ) {
      throw new ForbiddenException({
        code: 'auth.mfa_setup_required',
        detail:
          'Your role requires two-factor authentication. Set it up under Security before continuing.',
      });
    }

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      targets,
    );
    const minLevel = this.reflector.getAllAndOverride<number | undefined>(
      MIN_ROLE_LEVEL_KEY,
      targets,
    );
    const features = this.reflector.getAllAndOverride<string[] | undefined>(
      REQUIRE_FEATURE_KEY,
      targets,
    );
    const anyFeatures = this.reflector.getAllAndOverride<string[] | undefined>(
      REQUIRE_ANY_FEATURE_KEY,
      targets,
    );
    if (!roles && minLevel === undefined && !features && !anyFeatures)
      return true;

    if (!user)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Authentication required.',
      });

    if (roles && !roles.includes(user.role)) {
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: `This action requires one of the roles: ${roles.join(', ')}.`,
      });
    }
    if (minLevel !== undefined && !hasMinimumLevel(user.role, minLevel)) {
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Your role does not have enough authority for this action.',
      });
    }
    if (anyFeatures?.length) {
      const effective = await this.permissions.effectiveFeatures(
        user.id,
        user.role,
      );
      if (!anyFeatures.some((code) => effective.has(code))) {
        throw new ForbiddenException({
          code: 'authz.forbidden',
          detail: `This action requires one of the features: ${anyFeatures.join(', ')}.`,
        });
      }
    }
    if (features?.length) {
      const effective = await this.permissions.effectiveFeatures(
        user.id,
        user.role,
      );
      const missing = features.find((code) => !effective.has(code));
      if (missing) {
        throw new ForbiddenException({
          code: 'authz.forbidden',
          detail: `This action requires the feature '${missing}'.`,
        });
      }
    }
    return true;
  }
}
