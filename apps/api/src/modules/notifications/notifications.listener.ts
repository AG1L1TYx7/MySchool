import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '../../common/events/domain-event';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  classAudience,
  organizationAudience,
  studentAudience,
} from './audience';
import { preview, recipientsExcluding } from './notification-rules';
import { NotificationsService } from './notifications.service';

/**
 * Turns domain events into notifications (docs/04 section 6). Each handler is best-effort:
 * a notification failure never fails the action that caused it.
 */
@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @OnEvent('assignment.published', { async: true })
  async onAssignmentPublished(
    event: DomainEvent<{
      assignmentId: string;
      classId: string;
      title: string;
      dueAt: string | null;
    }>,
  ): Promise<void> {
    await this.guard('assignment.published', async () => {
      const a = await classAudience(this.prisma, event.data.classId);
      const due = event.data.dueAt
        ? ` Due ${new Date(event.data.dueAt).toLocaleDateString('en-US')}.`
        : '';
      await this.notifications.notify(
        recipientsExcluding([...a.students, ...a.guardians], event.actorId),
        {
          category: 'ASSIGNMENT',
          title: `New assignment: ${event.data.title}`,
          body: `Posted to your class.${due}`,
          link: `/assignments/${event.data.assignmentId}`,
          entityType: 'Assignment',
          entityId: event.data.assignmentId,
        },
      );
    });
  }

  @OnEvent('assignment.submitted', { async: true })
  async onSubmitted(
    event: DomainEvent<{
      assignmentId: string;
      studentId: string;
      attemptNumber: number;
      late: boolean;
    }>,
  ): Promise<void> {
    await this.guard('assignment.submitted', async () => {
      const assignment = await this.prisma.assignment.findFirst({
        where: { id: event.data.assignmentId },
        select: { title: true, classId: true },
      });
      const student = await this.prisma.student.findFirst({
        where: { id: event.data.studentId },
        select: { firstName: true, lastName: true },
      });
      if (!assignment || !student) return;
      const a = await classAudience(this.prisma, assignment.classId);
      await this.notifications.notify(
        recipientsExcluding(a.teachers, event.actorId),
        {
          category: 'ASSIGNMENT',
          title: `${student.firstName} ${student.lastName} submitted ${assignment.title}`,
          body: `Attempt ${event.data.attemptNumber}${event.data.late ? ' (late)' : ''}.`,
          link: `/assignments/${event.data.assignmentId}`,
          entityType: 'Assignment',
          entityId: event.data.assignmentId,
        },
      );
    });
  }

  @OnEvent('grade.posted', { async: true })
  async onGradePosted(
    event: DomainEvent<{
      assignmentId: string;
      studentId: string;
      score: number;
      maxPoints: number;
      percentage: number;
    }>,
  ): Promise<void> {
    await this.guard('grade.posted', async () => {
      const assignment = await this.prisma.assignment.findFirst({
        where: { id: event.data.assignmentId },
        select: { title: true },
      });
      if (!assignment) return;
      const a = await studentAudience(this.prisma, event.data.studentId);
      await this.notifications.notify(
        recipientsExcluding([a.student, ...a.guardians], event.actorId),
        {
          category: 'GRADE',
          title: `Grade posted: ${assignment.title}`,
          body: `${event.data.score} of ${event.data.maxPoints} (${event.data.percentage}%).`,
          link: `/assignments/${event.data.assignmentId}`,
          entityType: 'Assignment',
          entityId: event.data.assignmentId,
        },
      );
    });
  }

  @OnEvent('announcement.published', { async: true })
  async onAnnouncementPublished(
    event: DomainEvent<{
      announcementId: string;
      title: string;
      classId: string | null;
      priority: string;
      type: string;
    }>,
  ): Promise<void> {
    await this.guard('announcement.published', async () => {
      if (!event.organizationId) return;
      let recipients: string[];
      if (event.data.classId) {
        const a = await classAudience(this.prisma, event.data.classId);
        recipients = [...a.teachers, ...a.students, ...a.guardians];
      } else {
        recipients = await organizationAudience(
          this.prisma,
          event.organizationId,
        );
      }
      const urgent =
        event.data.priority === 'URGENT' || event.data.type === 'EMERGENCY';
      await this.notifications.notify(
        recipientsExcluding(recipients, event.actorId),
        {
          category: 'ANNOUNCEMENT',
          title: `${urgent ? 'Urgent: ' : ''}${event.data.title}`,
          body: event.data.classId
            ? 'Posted to your class.'
            : 'Posted to the whole school.',
          link: `/announcements/${event.data.announcementId}`,
          entityType: 'Announcement',
          entityId: event.data.announcementId,
          forceEmail: urgent,
        },
      );
    });
  }

  @OnEvent('message.sent', { async: true })
  async onMessageSent(
    event: DomainEvent<{
      conversationId: string;
      messageId: string;
      recipientIds: string[];
      senderName: string;
      content: string;
      conversationTitle: string | null;
    }>,
  ): Promise<void> {
    await this.guard('message.sent', async () => {
      await this.notifications.notify(
        recipientsExcluding(event.data.recipientIds, event.actorId),
        {
          category: 'MESSAGE',
          title: event.data.conversationTitle
            ? `${event.data.senderName} in ${event.data.conversationTitle}`
            : `Message from ${event.data.senderName}`,
          body: preview(event.data.content),
          link: `/messages/${event.data.conversationId}`,
          entityType: 'Conversation',
          entityId: event.data.conversationId,
        },
      );
    });
  }

  private async guard(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.warn(
        `Notification for ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
