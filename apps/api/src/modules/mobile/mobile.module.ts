import { Module } from '@nestjs/common';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { AssignmentsModule } from '../assignments/assignments.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { ClassesModule } from '../classes/classes.module';
import { MotivationModule } from '../motivation/motivation.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MobileController } from './mobile.controller';
import { MobileService } from './mobile.service';

@Module({
  imports: [
    ClassesModule,
    AssignmentsModule,
    AnnouncementsModule,
    NotificationsModule,
    MotivationModule,
    AttendanceModule,
  ],
  controllers: [MobileController],
  providers: [MobileService],
})
export class MobileModule {}
