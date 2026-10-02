import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  FeatureGate,
  RequireFeature,
} from '../access/decorators/access.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AiContentService } from './ai-content.service';
import { GenerateContentDto, RegenerateDto } from './dto/ai-content.dto';

@ApiTags('AI content')
@ApiBearerAuth('bearer')
@FeatureGate('ai.content-generation')
@Controller('ai')
export class AiContentController {
  constructor(private readonly content: AiContentService) {}

  @Post('content/quizzes')
  @HttpCode(202)
  @RequireFeature('ai.content.quiz')
  @ApiOperation({
    summary: 'Generate a quiz draft (202 + job); poll /ai/jobs/{id}',
  })
  quizzes(
    @Body() dto: GenerateContentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.content.generate('content.quiz', dto, actor);
  }

  @Post('content/flashcards')
  @HttpCode(202)
  @RequireFeature('ai.content.flashcards')
  @ApiOperation({ summary: 'Generate a flashcard deck draft (202 + job)' })
  flashcards(
    @Body() dto: GenerateContentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.content.generate('content.flashcards', dto, actor);
  }

  @Post('content/:id/regenerate')
  @HttpCode(202)
  @RequireFeature('ai.content.generate')
  @ApiOperation({
    summary: 'A new draft from teacher feedback on an existing AI draft',
  })
  regenerate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegenerateDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.content.regenerate(id, dto, actor);
  }

  @Get('jobs/:id')
  @RequireFeature('ai.content.generate')
  @ApiOperation({
    summary:
      'Job status; when done, the draft content id (and the content) are included',
  })
  job(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.content.get(id, actor);
  }
}
