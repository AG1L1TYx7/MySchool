import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AppConfigService } from '../../config/app-config.service';

/**
 * Authenticates the AI service on the internal tool API (docs/10 section 4, ADR-022).
 * Routes using it are marked @Public() so the JWT guard skips them; this guard then requires
 * the shared service token in X-Service-Token.
 */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const presented = req.headers['x-service-token'];
    const token = Array.isArray(presented) ? presented[0] : presented;
    const expected = this.config.get('AI_CALLBACK_TOKEN');
    if (
      !token ||
      token.length !== expected.length ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(expected))
    ) {
      throw new UnauthorizedException({
        code: 'auth.service_token',
        detail: 'A valid service token is required.',
      });
    }
    return true;
  }
}
