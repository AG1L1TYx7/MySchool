import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  FeatureGate,
  RequireFeature,
} from '../access/decorators/access.decorators';
import { resolveOrganizationId } from '../access/scope';
import { Audit } from '../audit/audit.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AiClient } from './ai.client';
import { AiTutorService } from './ai-tutor.service';
import {
  CreateConversationDto,
  FeedbackDto,
  SendMessageDto,
} from './dto/ai.dto';

@ApiTags('AI tutor')
@ApiBearerAuth('bearer')
@FeatureGate('ai.tutor')
@Controller('ai/tutor')
export class AiTutorController {
  constructor(
    private readonly tutor: AiTutorService,
    private readonly ai: AiClient,
  ) {}

  @Get('status')
  @RequireFeature('ai.tutor.chat')
  @ApiOperation({
    summary:
      'Whether the tutor is available right now (honest: no fallback answers)',
  })
  async status() {
    const health = await this.ai.health();
    return {
      available: !!health && health.status !== 'unhealthy',
      status: health?.status ?? 'unreachable',
      models: health?.models ?? {},
      promptVersions: health?.promptVersions ?? [],
    };
  }

  @Get('conversations')
  @RequireFeature('ai.tutor.chat')
  @ApiOperation({ summary: 'My tutor conversations' })
  async list(@CurrentUser() actor: AuthenticatedUser) {
    return { data: await this.tutor.list(actor) };
  }

  @Post('conversations')
  @HttpCode(201)
  @RequireFeature('ai.tutor.chat')
  @Audit('ai.conversation.create', 'AiConversation')
  @ApiOperation({
    summary:
      'Start a conversation (explain, socratic or homework mode; optional lesson or course context)',
  })
  create(
    @Body() dto: CreateConversationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.tutor.create(dto, actor);
  }

  @Get('conversations/:id')
  @RequireFeature('ai.tutor.chat')
  @ApiOperation({
    summary: 'A conversation with its messages, citations and safety labels',
  })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.tutor.get(id, actor);
  }

  @Delete('conversations/:id')
  @HttpCode(204)
  @RequireFeature('ai.tutor.chat')
  @ApiOperation({ summary: 'Delete a conversation' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.tutor.remove(id, actor);
  }

  @Post('conversations/:id/messages')
  @HttpCode(200)
  @RequireFeature('ai.tutor.chat')
  @ApiOperation({
    summary:
      'Send a message; JSON reply, or text/event-stream (user, token*, assistant events) when stream=true',
  })
  async send(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (dto.stream) {
      await this.tutor.stream(id, dto.content, actor, res);
      return;
    }
    return this.tutor.send(id, dto.content, actor);
  }

  @Post('messages/:id/feedback')
  @HttpCode(204)
  @RequireFeature('ai.tutor.chat')
  @ApiOperation({
    summary:
      'Thumbs up or down on an assistant message (feeds the weekly trace review)',
  })
  async feedback(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FeedbackDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.tutor.feedback(id, dto, actor);
  }
}

@ApiTags('AI tutor')
@ApiBearerAuth('bearer')
@Controller('ai/rag')
export class AiRagController {
  constructor(private readonly tutor: AiTutorService) {}

  @Post('reindex')
  @HttpCode(200)
  @RequireFeature('system.health.view')
  @Audit('ai.rag.reindex', 'Organization')
  @ApiOperation({
    summary:
      "Re-index the organisation's published lesson text for the tutor (also runs nightly)",
  })
  reindex(
    @Body() body: { organizationId?: string },
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.tutor.reindex(
      resolveOrganizationId(actor, body?.organizationId),
      actor,
    );
  }
}
