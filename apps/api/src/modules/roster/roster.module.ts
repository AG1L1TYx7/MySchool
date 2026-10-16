import { Module } from '@nestjs/common';
import { ClassroomController } from './classroom.controller';
import { ClassroomService } from './classroom.service';
import { RosterController } from './roster.controller';
import { RosterSyncService } from './roster-sync.service';
import { RosterService } from './roster.service';

@Module({
  controllers: [RosterController, ClassroomController],
  providers: [RosterService, RosterSyncService, ClassroomService],
  exports: [RosterService, RosterSyncService],
})
export class RosterModule {}
