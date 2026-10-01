import { Module } from '@nestjs/common';
import { AiClient } from './ai.client';
import { AiRagController, AiTutorController } from './ai.controller';
import { AiTutorService } from './ai-tutor.service';
import { InternalAiController } from './internal.controller';
import { ServiceTokenGuard } from './service-token.guard';

@Module({
  controllers: [AiTutorController, AiRagController, InternalAiController],
  providers: [AiClient, AiTutorService, ServiceTokenGuard],
  exports: [AiClient],
})
export class AiModule {}
