import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { MotivationController } from './motivation.controller';
import { MotivationListener } from './motivation.listener';
import { MotivationService } from './motivation.service';

@Module({
  imports: [NotificationsModule],
  controllers: [MotivationController],
  providers: [MotivationService, MotivationListener],
  exports: [MotivationService],
})
export class MotivationModule {}
