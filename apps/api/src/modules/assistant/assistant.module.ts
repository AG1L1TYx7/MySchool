import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AssignmentsModule } from '../assignments/assignments.module';
import { CalendarModule } from '../calendar/calendar.module';
import { MessagingModule } from '../messaging/messaging.module';
import { ReportCardsModule } from '../report-cards/report-cards.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';

@Module({
  imports: [
    AiModule,
    AssignmentsModule,
    MessagingModule,
    ReportCardsModule,
    CalendarModule,
  ],
  controllers: [AssistantController],
  providers: [AssistantService],
  exports: [AssistantService],
})
export class AssistantModule {}
