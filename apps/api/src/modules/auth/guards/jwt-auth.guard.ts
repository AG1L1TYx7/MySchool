import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { lastValueFrom } from 'rxjs';
import { ApiKeysService } from '../../integrations/api-keys.service';
import type { AuthenticatedUser } from '../auth.types';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/** Global guard: every route requires a valid bearer token unless marked @Public(). */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeysService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    // Integrations present an API key instead of a bearer token (slice 21).
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const presented = req.headers['x-api-key'];
    if (typeof presented === 'string' && presented.length > 0) {
      req.user = await this.apiKeys.authenticate(presented);
      return true;
    }
    const result = super.canActivate(context);
    if (typeof result === 'boolean') return result;
    return result instanceof Promise ? result : lastValueFrom(result);
  }

  handleRequest<TUser>(err: unknown, user: TUser | false): TUser {
    if (err || !user) {
      throw err instanceof UnauthorizedException
        ? err
        : new UnauthorizedException({
            code: 'auth.unauthorized',
            detail: 'A valid bearer token is required.',
          });
    }
    return user;
  }
}
