import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { GradebookModule } from '../gradebook/gradebook.module';
import { StandardsModule } from '../standards/standards.module';
import {
  AssignmentsController,
  GradesController,
  RubricsController,
  SubmissionsController,
} from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { RubricsService } from './rubrics.service';

@Module({
  imports: [FilesModule, GradebookModule, StandardsModule],
  controllers: [
    AssignmentsController,
    SubmissionsController,
    GradesController,
    RubricsController,
  ],
  providers: [AssignmentsService, RubricsService],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
