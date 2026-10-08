import { Module } from '@nestjs/common';
import { CareersController } from './careers.controller';
import { CareersService } from './careers.service';
import { CodeRunnerService } from './code-runner.service';

@Module({
  controllers: [CareersController],
  providers: [CareersService, CodeRunnerService],
  exports: [CareersService],
})
export class CareersModule {}
