import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '../../common/events/domain-event';
import { LtiServicesService } from './lti-services.service';

/** A posted grade reaches the platform's gradebook without anyone exporting (slice 30). */
@Injectable()
export class LtiServicesListener {
  private readonly log = new Logger(LtiServicesListener.name);

  constructor(private readonly services: LtiServicesService) {}

  @OnEvent('grade.posted', { async: true })
  async onGraded(
    event: DomainEvent<{ assignmentId?: string; studentId?: string }>,
  ) {
    const { assignmentId, studentId } = event.data ?? {};
    if (!assignmentId || !studentId) return;
    try {
      await this.services.pushScore(assignmentId, studentId);
    } catch (err) {
      this.log.warn(`LTI score push skipped: ${(err as Error).message}`);
    }
  }
}
