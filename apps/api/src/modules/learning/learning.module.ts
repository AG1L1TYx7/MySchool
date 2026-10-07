import { Module } from '@nestjs/common';
import { MotivationModule } from '../motivation/motivation.module';
import { LearningController } from './learning.controller';
import { LearningListener } from './learning.listener';
import { LearningService } from './learning.service';

@Module({
  imports: [MotivationModule],
  controllers: [LearningController],
  providers: [LearningService, LearningListener],
  exports: [LearningService],
})
export class LearningModule {}
