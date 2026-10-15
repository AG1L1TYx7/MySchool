import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '../../common/events/domain-event';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PathsService } from './paths.service';
import { invalidatesProfile } from './paths-rules';

/** Learning events move paths forward without anyone ticking boxes. */
@Injectable()
export class PathsListener {
  private readonly log = new Logger(PathsListener.name);

  constructor(
    private readonly paths: PathsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Any event that moves the profile's inputs drops that student's cached profile (slice 28). */
  @OnEvent('**', { async: true })
  onAny(event: DomainEvent<{ studentId?: string }>) {
    if (!event || typeof event.eventType !== 'string') return;
    if (!invalidatesProfile(event.eventType)) return;
    this.paths.invalidateProfile(event.data?.studentId);
  }

  @OnEvent('lesson.completed', { async: true })
  async onLessonCompleted(
    event: DomainEvent<{ studentId?: string; lessonId?: string }>,
  ) {
    const studentId = event.data.studentId;
    const lessonId = event.data.lessonId ?? event.entityId;
    if (!studentId || !lessonId) return;
    await this.safely(() =>
      this.paths.applyEvent(studentId, { kind: 'lesson', refId: lessonId }),
    );
  }

  @OnEvent('h5p.result.recorded', { async: true })
  async onResult(
    event: DomainEvent<{
      studentId?: string;
      contentId?: string;
      score?: number;
      maxScore?: number;
    }>,
  ) {
    const { studentId, contentId, score, maxScore } = event.data;
    if (!studentId || !contentId) return;
    const fraction =
      typeof score === 'number' && typeof maxScore === 'number' && maxScore > 0
        ? score / maxScore
        : null;
    await this.safely(() =>
      this.paths.applyEvent(studentId, {
        kind: 'h5p',
        refId: contentId,
        fraction,
      }),
    );
  }

  @OnEvent('assignment.submitted', { async: true })
  async onSubmitted(
    event: DomainEvent<{ studentId?: string; assignmentId?: string }>,
  ) {
    const studentId = event.data.studentId;
    const assignmentId = event.data.assignmentId ?? event.entityId;
    if (!studentId || !assignmentId) return;
    await this.safely(() =>
      this.paths.applyEvent(studentId, {
        kind: 'assignment',
        refId: assignmentId,
      }),
    );
  }

  @OnEvent('grade.posted', { async: true })
  async onGraded(
    event: DomainEvent<{ studentId?: string; assignmentId?: string }>,
  ) {
    const { studentId, assignmentId } = event.data;
    if (!studentId || !assignmentId) return;
    await this.safely(() =>
      this.paths.applyEvent(studentId, {
        kind: 'assignment',
        refId: assignmentId,
      }),
    );
  }

  @OnEvent('practice.reviewed', { async: true })
  async onPractice(event: DomainEvent<{ studentId?: string }>) {
    const studentId = event.data.studentId;
    if (!studentId) return;
    await this.safely(() =>
      this.paths.applyEvent(studentId, { kind: 'practice', refId: null }),
    );
  }

  private async safely(fn: () => Promise<number>) {
    try {
      await fn();
    } catch (err) {
      this.log.warn(`path step update skipped: ${(err as Error).message}`);
    }
  }
}
