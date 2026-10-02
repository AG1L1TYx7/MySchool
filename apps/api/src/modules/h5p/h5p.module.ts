import { Module } from '@nestjs/common';
import { AssignmentsModule } from '../assignments/assignments.module';
import { H5pController, H5pPlayController } from './h5p.controller';
import { H5pService } from './h5p.service';

@Module({
  imports: [AssignmentsModule],
  controllers: [H5pController, H5pPlayController],
  providers: [H5pService],
  exports: [H5pService],
})
export class H5pModule {}
