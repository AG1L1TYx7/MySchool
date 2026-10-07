import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '../../common/events/domain-event';
import { LearningService } from './learning.service';

/** Turns what students do into learning records and mastery evidence; never fails the action that caused it. */
@Injectable()
export class LearningListener {
  private readonly logger = new Logger(LearningListener.name);

  constructor(private readonly learning: LearningService) {}

  @OnEvent('h5p.result.recorded', { async: true })
  async onResult(
    event: DomainEvent<{
      resultId: string;
      contentId: string;
      studentId: string | null;
      assignmentId: string | null;
      score: number;
      maxScore: number;
      completed: boolean;
      timeSpentSeconds: number | null;
    }>,
  ): Promise<void> {
    await this.guard('h5p.result.recorded', () =>
      this.learning.onH5pResult({
        ...event.data,
        actorUserId: event.actorId ?? '',
        organizationId: event.organizationId,
      }),
    );
  }

  @OnEvent('lesson.completed', { async: true })
  async onLesson(
    event: DomainEvent<{
      lessonId: string;
      studentId: string;
      courseId: string;
    }>,
  ): Promise<void> {
    await this.guard('lesson.completed', () =>
      this.learning.onLessonCompleted(
        event.data.studentId,
        event.data.lessonId,
        event.actorId ?? '',
        event.organizationId,
      ),
    );
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
    await this.guard('assignment.submitted', () =>
      this.learning.onSubmitted(
        event.data.studentId,
        event.data.assignmentId,
        event.data.attemptNumber,
        event.actorId ?? '',
        event.organizationId,
      ),
    );
  }

  @OnEvent('grade.posted', { async: true })
  async onGraded(
    event: DomainEvent<{
      assignmentId: string;
      studentId: string;
      score: number;
      maxPoints: number;
      percentage: number;
    }>,
  ): Promise<void> {
    await this.guard('grade.posted', () =>
      this.learning.onGraded(
        event.data.studentId,
        event.data.assignmentId,
        event.data.score,
        event.data.maxPoints,
        event.actorId ?? '',
        event.organizationId,
      ),
    );
  }

  private async guard(name: string, fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (err) {
      this.logger.warn(
        `Learning record for ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
