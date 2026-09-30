import { newId } from '../utils/ids';

/** Domain event envelope (docs/04 section 6). Emitted in-process now; a webhook fan-out subscribes in Release 3. */
export interface DomainEvent<T = Record<string, unknown>> {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  organizationId: string | null;
  occurredAt: string;
  actorId: string | null;
  data: T;
}

export function domainEvent<T extends Record<string, unknown>>(input: {
  eventType: string;
  entityType: string;
  entityId: string;
  organizationId: string | null;
  actorId?: string | null;
  data: T;
}): DomainEvent<T> {
  return {
    id: newId(),
    occurredAt: new Date().toISOString(),
    actorId: input.actorId ?? null,
    ...input,
  };
}
