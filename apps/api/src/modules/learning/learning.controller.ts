import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireFeature } from '../access/decorators/access.decorators';
import { Audit } from '../audit/audit.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  CreateCardDto,
  ExportQuery,
  ReviewCardDto,
  StatementsQuery,
} from './dto/learning.dto';
import { LearningService } from './learning.service';

@ApiTags('Learning')
@ApiBearerAuth('bearer')
@Controller()
export class LearningController {
  constructor(private readonly learning: LearningService) {}

  // Practice cards (students) ------------------------------------------------
  @Get('practice/queue')
  @RequireFeature('learning.view')
  @ApiOperation({
    summary: 'Cards due today, then new ones, for the signed-in student',
  })
  queue(
    @Query('limit') limit: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.learning.queue(
      actor,
      Math.min(50, Math.max(1, Number(limit) || 20)),
    );
  }

  @Get('practice/cards')
  @RequireFeature('learning.view')
  async cards(
    @Query('status') status: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.learning.cards(actor, status) };
  }

  @Post('practice/cards')
  @HttpCode(201)
  @RequireFeature('learning.view')
  createCard(
    @Body() dto: CreateCardDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.learning.createCard(dto, actor);
  }

  @Post('practice/cards/from-content/:contentId')
  @HttpCode(201)
  @RequireFeature('learning.view')
  @ApiOperation({
    summary:
      'Turn a published flashcard set into practice cards (once per card)',
  })
  fromContent(
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.learning.cardsFromContent(contentId, actor);
  }

  @Post('practice/cards/:id/review')
  @HttpCode(200)
  @RequireFeature('learning.view')
  @ApiOperation({
    summary: 'Grade a recall 0 to 5; SM-2 schedules the next review',
  })
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewCardDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.learning.review(id, dto, actor);
  }

  @Post('practice/cards/:id/suspend')
  @HttpCode(200)
  @RequireFeature('learning.view')
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { suspended?: boolean },
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.learning.suspendCard(id, body?.suspended !== false, actor);
  }

  @Delete('practice/cards/:id')
  @HttpCode(204)
  @RequireFeature('learning.view')
  async removeCard(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.learning.removeCard(id, actor);
  }

  @Get('me/practice')
  @RequireFeature('learning.view')
  async myPractice(@CurrentUser() actor: AuthenticatedUser) {
    const student = await this.learning.myMastery(actor);
    return this.learning.practiceStats(student.student.id);
  }

  // Mastery and curves -------------------------------------------------------
  @Get('me/mastery')
  @RequireFeature('learning.view')
  myMastery(@CurrentUser() actor: AuthenticatedUser) {
    return this.learning.myMastery(actor);
  }

  @Get('me/learning/curve')
  @RequireFeature('learning.view')
  myCurve(@CurrentUser() actor: AuthenticatedUser) {
    return this.learning.myCurve(actor);
  }

  @Get('students/:id/mastery')
  @RequireFeature('learning.view')
  @ApiOperation({
    summary:
      "A student's mastery per standard: family, teachers, counselors, administrators",
  })
  mastery(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.learning.masteryFor(id, actor);
  }

  @Get('students/:id/learning/curve')
  @RequireFeature('learning.view')
  curve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.learning.curveFor(id, actor);
  }

  @Get('students/:id/learning/records')
  @RequireFeature('learning.view')
  @ApiOperation({
    summary: "A student's recent learning records (xAPI), newest first",
  })
  async records(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return {
      data: await this.learning.timeline(id, actor, Number(limit) || 50),
    };
  }

  @Get('students/:id/practice')
  @RequireFeature('learning.view')
  async practice(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    await this.learning.masteryFor(id, actor); // the same visibility rule
    return this.learning.practiceStats(id);
  }

  @Get('courses/:id/mastery')
  @RequireFeature('learning.view')
  @ApiOperation({
    summary:
      'Mastery rings per module for one student (studentId for a child or a taught student)',
  })
  courseMastery(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('studentId') studentId: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.learning.courseMastery(id, actor, studentId);
  }

  @Get('classes/:id/mastery')
  @RequireFeature('learning.records')
  @ApiOperation({
    summary: 'The class per standard: average, bands, who needs help',
  })
  classMastery(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.learning.classMastery(id, actor);
  }

  @Get('classes/:id/learning/curve')
  @RequireFeature('learning.records')
  classCurve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.learning.classCurve(id, actor);
  }

  // Records ------------------------------------------------------------------
  @Get('h5p/contents/:id/analytics')
  @RequireFeature('learning.records')
  analytics(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.learning.contentAnalytics(id, actor);
  }

  @Get('xapi/statements')
  @RequireFeature('learning.records')
  @ApiOperation({
    summary:
      'Query learning records by student, object, verb and time (own school)',
  })
  async statements(
    @Query() q: StatementsQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.learning.statements(q, actor) };
  }

  @Get('organizations/:organizationId/xapi/export')
  @RequireFeature('organizations.structure')
  @Audit('learning.xapi.export', 'Organization')
  @ApiOperation({
    summary:
      'Full xAPI statements for an external record store, oldest first, resumable with since',
  })
  exportStatements(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query() q: ExportQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.learning.exportStatements(organizationId, q, actor);
  }
}
