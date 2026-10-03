import { Module } from '@nestjs/common';
import {
  ClassGradingController,
  MarksController,
  ProficiencyScalesController,
} from './gradebook.controller';
import { GradebookService } from './gradebook.service';

@Module({
  controllers: [
    ClassGradingController,
    MarksController,
    ProficiencyScalesController,
  ],
  providers: [GradebookService],
  exports: [GradebookService],
})
export class GradebookModule {}
