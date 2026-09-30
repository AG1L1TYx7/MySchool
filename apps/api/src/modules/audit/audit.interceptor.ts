import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AUDIT_KEY, type AuditMetadata } from './audit.decorator';
import { AuditService } from './audit.service';

/** Writes an audit row for @Audit handlers after a successful (2xx) response. */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMetadata | undefined>(
      AUDIT_KEY,
      context.getHandler(),
    );
    if (!meta) return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<
      Request & { user?: AuthenticatedUser; id?: string }
    >();
    const res = http.getResponse<Response>();

    return next.handle().pipe(
      tap(() => {
        if (res.statusCode < 200 || res.statusCode >= 300) return;
        const params = req.params as Record<string, string>;
        void this.audit.record({
          userId: req.user?.id,
          organizationId: req.user?.organizationId,
          action: meta.action,
          entityType: meta.entityType,
          entityId:
            params.id ??
            params.userId ??
            params.code ??
            params.name ??
            params.role ??
            null,
          ipAddress: clientIp(req),
          userAgent: req.headers['user-agent'],
          requestPath: req.originalUrl,
          httpMethod: req.method,
          statusCode: res.statusCode,
          traceId: typeof req.id === 'string' ? req.id : null,
        });
      }),
    );
  }
}

export function clientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded)
    ? forwarded[0]
    : forwarded?.split(',')[0];
  return first?.trim() || req.ip || req.socket.remoteAddress || null;
}
