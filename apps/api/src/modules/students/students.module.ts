import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { StudentsImportService } from './students-import.service';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

@Module({
  imports: [UsersModule],
  controllers: [StudentsController],
  providers: [StudentsService, StudentsImportService],
  exports: [StudentsService],
})
export class StudentsModule {}
