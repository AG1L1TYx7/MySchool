import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { FamilyController } from './family.controller';
import { FamilyService } from './family.service';

@Module({
  imports: [NotificationsModule],
  controllers: [FamilyController],
  providers: [FamilyService],
  exports: [FamilyService],
})
export class FamilyModule {}
