import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireFeature } from '../access/decorators/access.decorators';
import { Audit } from '../audit/audit.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  GenerateConferenceDto,
  GenerateSummaryDto,
  UpdateSummaryDto,
} from './dto/summaries.dto';
import { SummariesService } from './summaries.service';

@ApiTags('Family')
@ApiBearerAuth('bearer')
@Controller()
export class SummariesController {
  constructor(private readonly summaries: SummariesService) {}

  @Get('lessons/:id/summaries')
  @RequireFeature('courses.view')
  @ApiOperation({
    summary:
      'Family-language summaries of a lesson: staff see drafts, families see released ones',
  })
  async list(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.summaries.summaries(id, actor) };
  }

  @Post('lessons/:id/summaries')
  @HttpCode(202)
  @RequireFeature('ai.content.summary')
  @Audit('summaries.generate', 'Lesson')
  @ApiOperation({
    summary:
      'Ask the AI service for a draft summary in a language; poll /ai/jobs/{id}',
  })
  generate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateSummaryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.summaries.generateSummary(id, dto, actor);
  }

  @Patch('lesson-summaries/:id')
  @RequireFeature('ai.content.summary')
  @ApiOperation({
    summary: 'Edit the draft, or release it to families (status released)',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSummaryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.summaries.updateSummary(id, dto, actor);
  }

  @Delete('lesson-summaries/:id')
  @HttpCode(204)
  @RequireFeature('ai.content.summary')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.summaries.removeSummary(id, actor);
  }

  @Get('students/:id/conference-notes')
  @RequireFeature('ai.content.conference')
  @ApiOperation({
    summary:
      'AI-drafted talking points for a family conference (the student’s teachers, counselors, administrators)',
  })
  async notes(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.summaries.conferenceNotes(id, actor) };
  }

  @Post('students/:id/conference-notes')
  @HttpCode(202)
  @RequireFeature('ai.content.conference')
  @Audit('summaries.conference', 'Student')
  generateNotes(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateConferenceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.summaries.generateConference(id, dto, actor);
  }

  @Delete('conference-notes/:id')
  @HttpCode(204)
  @RequireFeature('ai.content.conference')
  async removeNote(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.summaries.removeConferenceNote(id, actor);
  }
}
