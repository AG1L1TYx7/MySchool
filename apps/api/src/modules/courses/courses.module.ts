import { Module } from '@nestjs/common';
import {
  CoursesController,
  LessonsController,
  ModulesController,
} from './courses.controller';
import { CoursesService } from './courses.service';

@Module({
  controllers: [CoursesController, ModulesController, LessonsController],
  providers: [CoursesService],
  exports: [CoursesService],
})
export class CoursesModule {}
