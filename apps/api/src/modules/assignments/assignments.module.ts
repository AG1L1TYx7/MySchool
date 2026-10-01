import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import {
  AssignmentsController,
  GradebookController,
  GradesController,
  RubricsController,
  SubmissionsController,
} from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { RubricsService } from './rubrics.service';

@Module({
  imports: [FilesModule],
  controllers: [
    AssignmentsController,
    SubmissionsController,
    GradesController,
    GradebookController,
    RubricsController,
  ],
  providers: [AssignmentsService, RubricsService],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
