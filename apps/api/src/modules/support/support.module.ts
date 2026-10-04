import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  StudentSupportController,
  SupportController,
} from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [NotificationsModule],
  controllers: [StudentSupportController, SupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
