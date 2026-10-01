import { Module } from '@nestjs/common';
import {
  ClassesController,
  StudentClassesController,
} from './classes.controller';
import { ClassesService } from './classes.service';

@Module({
  controllers: [ClassesController, StudentClassesController],
  providers: [ClassesService],
  exports: [ClassesService],
})
export class ClassesModule {}
