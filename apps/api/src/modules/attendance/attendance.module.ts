import { Module } from '@nestjs/common';
import {
  AttendanceController,
  ClassAttendanceController,
  StudentAttendanceController,
} from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
  controllers: [
    AttendanceController,
    ClassAttendanceController,
    StudentAttendanceController,
  ],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
