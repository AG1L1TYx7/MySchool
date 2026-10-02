import { Module } from '@nestjs/common';
import { RosterController } from './roster.controller';
import { RosterSyncService } from './roster-sync.service';
import { RosterService } from './roster.service';

@Module({
  controllers: [RosterController],
  providers: [RosterService, RosterSyncService],
  exports: [RosterService, RosterSyncService],
})
export class RosterModule {}
