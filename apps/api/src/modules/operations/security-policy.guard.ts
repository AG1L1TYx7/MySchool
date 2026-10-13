import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ROLE_API_NAME } from '../access/roles';
import { clientIp } from '../audit/audit.interceptor';
import type { AuthenticatedUser } from '../auth/auth.types';
import { TenantsService } from '../tenants/tenants.service';
import { ipAllowed, sessionTooOld } from './operations-rules';

/**
 * District security policy (slice 26), applied after sign-in: administrators may be limited to named IP
 * ranges, and a sign-in older than the district's session limit is closed. Public routes and API keys pass.
 */
@Injectable()
export class SecurityPolicyGuard implements CanActivate {
  constructor(private readonly tenants: TenantsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const user = req.user;
    if (!user || user.apiKey || !user.tenantId) return true;
    const policy = (await this.tenants.policiesFor(user.tenantId)).security;
    const role = ROLE_API_NAME[user.role];
    if (!ipAllowed(policy, role, clientIp(req))) {
      throw new ForbiddenException({
        code: 'security.ip_not_allowed',
        detail:
          'Administrators of this district may sign in only from approved networks.',
      });
    }
    if (
      user.sessionStartedAt &&
      sessionTooOld(policy, user.sessionStartedAt, new Date())
    ) {
      throw new UnauthorizedException({
        code: 'security.session_expired',
        detail:
          'Your sign-in is older than your district allows. Please sign in again.',
      });
    }
    return true;
  }
}
