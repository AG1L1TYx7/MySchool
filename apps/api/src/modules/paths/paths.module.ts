import { Module } from '@nestjs/common';
import { InsightModule } from '../insight/insight.module';
import { LearningModule } from '../learning/learning.module';
import { PathsController } from './paths.controller';
import { PathsListener } from './paths.listener';
import { PathsService } from './paths.service';

@Module({
  imports: [LearningModule, InsightModule],
  controllers: [PathsController],
  providers: [PathsService, PathsListener],
  exports: [PathsService],
})
export class PathsModule {}
