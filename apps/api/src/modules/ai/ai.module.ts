import { Module } from '@nestjs/common';
import { H5pModule } from '../h5p/h5p.module';
import { SupportModule } from '../support/support.module';
import { AiContentController } from './ai-content.controller';
import { AiContentService } from './ai-content.service';
import { AiClient } from './ai.client';
import { AiRagController, AiTutorController } from './ai.controller';
import { AiTutorService } from './ai-tutor.service';
import { InternalAiController } from './internal.controller';
import { ServiceTokenGuard } from './service-token.guard';

@Module({
  imports: [H5pModule, SupportModule],
  controllers: [
    AiTutorController,
    AiRagController,
    InternalAiController,
    AiContentController,
  ],
  providers: [AiClient, AiTutorService, AiContentService, ServiceTokenGuard],
  exports: [AiClient, AiContentService],
})
export class AiModule {}
