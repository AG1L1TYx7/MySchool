import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import type { AuthenticatedUser } from '../auth/auth.types';
import { isAiRoute } from './billing-rules';
import { UsageService } from './usage.service';

/** Counts every authenticated request against the caller's school and district (usage metering, slice 26). */
@Injectable()
export class UsageInterceptor implements NestInterceptor {
  constructor(private readonly usage: UsageService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const user = req.user;
    if (user?.organizationId && user.tenantId) {
      this.usage.record(
        user.tenantId,
        user.organizationId,
        user.id,
        isAiRoute(req.path),
      );
    }
    return next.handle();
  }
}
