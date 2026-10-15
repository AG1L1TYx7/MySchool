import { PathsListener } from './paths.listener';
import type { PathsService } from './paths.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { domainEvent } from '../../common/events/domain-event';

describe('PathsListener profile invalidation (slice 28)', () => {
  const calls: Array<string | undefined> = [];
  const paths = {
    invalidateProfile: (id?: string) => {
      calls.push(id);
    },
  } as unknown as PathsService;
  const listener = new PathsListener(paths, {} as PrismaService);

  it("drops one student's profile after a learning event, everyone's when the event names no student", () => {
    listener.onAny(
      domainEvent({
        eventType: 'grade.posted',
        entityType: 'Assignment',
        entityId: 'a1',
        organizationId: 'o1',
        data: { studentId: 's1' },
      }),
    );
    listener.onAny(
      domainEvent({
        eventType: 'attendance.marked',
        entityType: 'Attendance',
        entityId: 'x',
        organizationId: 'o1',
        data: {},
      }),
    );
    listener.onAny(
      domainEvent({
        eventType: 'message.sent',
        entityType: 'Message',
        entityId: 'm1',
        organizationId: 'o1',
        data: { studentId: 's2' },
      }),
    );
    expect(calls).toEqual(['s1', undefined]);
  });
});
