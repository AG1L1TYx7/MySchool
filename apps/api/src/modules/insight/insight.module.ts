import { Module } from '@nestjs/common';
import { MailModule } from '../../infra/mail/mail.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { InsightController } from './insight.controller';
import { InsightService } from './insight.service';

@Module({
  imports: [AttendanceModule, MailModule],
  controllers: [InsightController],
  providers: [InsightService],
  exports: [InsightService],
})
export class InsightModule {}
