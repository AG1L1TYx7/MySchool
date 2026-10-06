import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '../../common/events/domain-event';
import { MotivationService } from './motivation.service';

/**
 * Turns learning events into private rewards (docs/12 section 4). Best-effort: a reward failure never
 * fails the submission or grade that caused it.
 */
@Injectable()
export class MotivationListener {
  private readonly logger = new Logger(MotivationListener.name);

  constructor(private readonly motivation: MotivationService) {}

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
      this.motivation.onSubmitted(
        event.data.studentId,
        event.data.assignmentId,
        event.data.late,
        event.organizationId,
      ),
    );
  }

  @OnEvent('grade.posted', { async: true })
  async onGraded(
    event: DomainEvent<{
      assignmentId: string;
      studentId: string;
      percentage: number;
    }>,
  ): Promise<void> {
    await this.guard('grade.posted', () =>
      this.motivation.onGraded(
        event.data.studentId,
        event.data.assignmentId,
        event.data.percentage,
        event.organizationId,
      ),
    );
  }

  private async guard(name: string, fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (err) {
      this.logger.warn(
        `Reward for ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
