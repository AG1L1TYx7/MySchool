import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'audit:action';

export interface AuditMetadata {
  action: string;
  entityType?: string;
}

/**
 * Marks a handler as auditable. On a 2xx response the AuditInterceptor writes an
 * AuditLogs row with the actor, IP, user agent, path, method, status and route id.
 */
export const Audit = (action: string, entityType?: string) =>
  SetMetadata(AUDIT_KEY, { action, entityType } satisfies AuditMetadata);
