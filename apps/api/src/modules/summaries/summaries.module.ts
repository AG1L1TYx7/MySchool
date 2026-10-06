import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { SummariesController } from './summaries.controller';
import { SummariesService } from './summaries.service';

@Module({
  imports: [AiModule],
  controllers: [SummariesController],
  providers: [SummariesService],
  exports: [SummariesService],
})
export class SummariesModule {}
