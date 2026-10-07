import { Module } from '@nestjs/common';
import { PushModule } from '../push/push.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsListener } from './notifications.listener';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [PushModule, RealtimeModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsGateway,
    NotificationsService,
    NotificationsListener,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
