import { Module } from '@nestjs/common';
import {
  AttendanceController,
  ClassAttendanceController,
  StudentAttendanceController,
} from './attendance.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { AttendanceReportsController } from './attendance-reports.controller';
import { AttendanceReportsService } from './attendance-reports.service';
import { AttendanceService } from './attendance.service';

@Module({
  imports: [NotificationsModule],
  controllers: [
    AttendanceController,
    ClassAttendanceController,
    StudentAttendanceController,
    AttendanceReportsController,
  ],
  providers: [AttendanceService, AttendanceReportsService],
  exports: [AttendanceService, AttendanceReportsService],
})
export class AttendanceModule {}
