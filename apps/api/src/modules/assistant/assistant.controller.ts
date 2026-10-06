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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireFeature } from '../access/decorators/access.decorators';
import { Audit } from '../audit/audit.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AssistantService } from './assistant.service';
import {
  ApproveSuggestionDto,
  BulkNarrativeDto,
  DifferentiationDto,
  GeneratePlanDto,
  NarrativeDto,
  ParentEmailDto,
  PlannerQuery,
  PracticeSetDto,
  SubstituteDto,
  UpdateDraftDto,
  UpdateInsightDto,
  UpdatePlanDto,
} from './dto/assistant.dto';

@ApiTags('Teacher assistant')
@ApiBearerAuth('bearer')
@Controller()
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  // Lesson plans -------------------------------------------------------------
  @Get('assistant/lesson-plans')
  @RequireFeature('ai.assistant')
  @ApiOperation({ summary: 'My lesson plans (administrators: the school’s)' })
  async plans(
    @Query('classId') classId: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.assistant.lessonPlans(actor, classId) };
  }

  @Post('assistant/lesson-plans')
  @HttpCode(202)
  @RequireFeature('ai.assistant')
  @Audit('assistant.plan.generate', 'LessonPlan')
  @ApiOperation({
    summary:
      'Draft a lesson plan with the AI; poll /ai/jobs/{id}, resultId is the plan',
  })
  generatePlan(
    @Body() dto: GeneratePlanDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assistant.generatePlan(dto, actor);
  }

  @Get('lesson-plans/:id')
  @RequireFeature('ai.assistant')
  plan(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assistant.plan(id, actor);
  }

  @Patch('lesson-plans/:id')
  @RequireFeature('ai.assistant')
  @ApiOperation({ summary: 'Edit, schedule or publish a plan' })
  updatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assistant.updatePlan(id, dto, actor);
  }

  @Delete('lesson-plans/:id')
  @HttpCode(204)
  @RequireFeature('ai.assistant')
  async removePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.assistant.removePlan(id, actor);
  }

  // Grading suggestions ------------------------------------------------------
  @Post('assistant/grading/assignments/:assignmentId/suggest')
  @HttpCode(202)
  @RequireFeature('ai.assistant')
  @Audit('assistant.grading.suggest', 'Assignment')
  @ApiOperation({
    summary: 'Ask the AI for a suggestion on every ungraded text submission',
  })
  suggest(
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assistant.suggestGrades(assignmentId, actor);
  }

  @Get('assistant/grading/assignments/:assignmentId')
  @RequireFeature('ai.assistant')
  @ApiOperation({
    summary:
      'Suggestions for an assignment, with the submission excerpt and review state',
  })
  suggestions(
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assistant.suggestions(assignmentId, actor);
  }

  @Post('grading-suggestions/:id/approve')
  @HttpCode(200)
  @RequireFeature('ai.assistant')
  @Audit('assistant.grading.approve', 'GradingSuggestion')
  @ApiOperation({
    summary: 'Post the suggestion as the grade (optionally changed)',
  })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveSuggestionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assistant.approve(id, dto, actor);
  }

  @Post('grading-suggestions/:id/reject')
  @HttpCode(200)
  @RequireFeature('ai.assistant')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assistant.reject(id, actor);
  }

  @Post('assistant/grading/assignments/:assignmentId/approve-all')
  @HttpCode(200)
  @RequireFeature('ai.assistant')
  @Audit('assistant.grading.approve_all', 'Assignment')
  @ApiOperation({
    summary:
      'Post every confident suggestion as a grade; flagged ones stay for review',
  })
  approveAll(
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assistant.approveAll(assignmentId, actor);
  }

  // Drafts: parent emails, narratives, differentiation --------------------------
  @Get('assistant/drafts')
  @RequireFeature('ai.assistant')
  async drafts(
    @Query('kind') kind: string | undefined,
    @Query('studentId') studentId: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.assistant.drafts(actor, kind, studentId) };
  }

  @Post('assistant/drafts/parent-email')
  @HttpCode(202)
  @RequireFeature('ai.assistant')
  @Audit('assistant.email.draft', 'Student')
  parentEmail(
    @Body() dto: ParentEmailDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assistant.draftParentEmail(dto, actor);
  }

  @Post('assistant/drafts/narrative')
  @HttpCode(202)
  @RequireFeature('ai.assistant')
  narrative(
    @Body() dto: NarrativeDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assistant.draftNarrative(dto, actor);
  }

  @Post('assistant/drafts/narratives')
  @HttpCode(202)
  @RequireFeature('ai.assistant')
  @Audit('assistant.narratives.bulk', 'Class')
  narratives(
    @Body() dto: BulkNarrativeDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assistant.draftNarratives(dto, actor);
  }

  @Post('assistant/drafts/differentiation')
  @HttpCode(202)
  @RequireFeature('ai.assistant')
  differentiation(
    @Body() dto: DifferentiationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assistant.draftDifferentiation(dto, actor);
  }

  @Get('drafts/:id')
  @RequireFeature('ai.assistant')
  draft(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assistant.draft(id, actor);
  }

  @Patch('drafts/:id')
  @RequireFeature('ai.assistant')
  updateDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDraftDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assistant.updateDraft(id, dto, actor);
  }

  @Delete('drafts/:id')
  @HttpCode(204)
  @RequireFeature('ai.assistant')
  async removeDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.assistant.removeDraft(id, actor);
  }

  @Post('drafts/:id/send')
  @HttpCode(200)
  @RequireFeature('ai.assistant')
  @Audit('assistant.email.sent', 'TeacherDraft')
  @ApiOperation({
    summary:
      'Send a parent email draft as a message to the student’s guardians',
  })
  send(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assistant.sendParentEmail(id, actor);
  }

  @Post('drafts/:id/apply-to-report-card')
  @HttpCode(200)
  @RequireFeature('ai.assistant')
  @Audit('assistant.narrative.applied', 'TeacherDraft')
  @ApiOperation({
    summary:
      'Put the narrative on the student’s draft report card line for that class',
  })
  apply(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assistant.applyNarrative(id, actor);
  }

  @Post('drafts/:id/create-lessons')
  @HttpCode(201)
  @RequireFeature('ai.assistant')
  @Audit('assistant.differentiation.lessons', 'TeacherDraft')
  @ApiOperation({
    summary:
      'Create three unpublished lessons (support, core, extension) from a differentiation draft',
  })
  createLessons(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assistant.createLevelLessons(id, actor);
  }

  // Class insight ---------------------------------------------------------------
  @Get('assistant/classes/:classId/insight')
  @RequireFeature('ai.assistant')
  insight(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assistant.classInsight(classId, actor);
  }

  @Post('assistant/classes/:classId/insight')
  @HttpCode(202)
  @RequireFeature('ai.assistant')
  @Audit('assistant.insight.build', 'Class')
  @ApiOperation({
    summary:
      'Compute this week’s class numbers (tutor traces, work, attendance) and narrate them',
  })
  buildInsight(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assistant.buildInsight(classId, actor);
  }

  @Post('assistant/insights/:id/practice-set')
  @HttpCode(202)
  @RequireFeature('ai.assistant')
  @ApiOperation({
    summary:
      'Generate a short quiz on the topic the class is stuck on (an H5P content job)',
  })
  practiceSet(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PracticeSetDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assistant.practiceSet(id, dto, actor);
  }

  @Patch('assistant/insights/:id')
  @RequireFeature('ai.assistant')
  updateInsight(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInsightDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assistant.updateInsight(id, dto, actor);
  }

  // Substitutes and the planner --------------------------------------------------
  @Get('classes/:id/substitutes')
  @RequireFeature('classes.substitutes')
  async substitutes(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.assistant.substitutes(id, actor) };
  }

  @Get('classes/:id/substitutes/candidates')
  @RequireFeature('classes.substitutes')
  @ApiOperation({
    summary: 'Teachers and assistants of the school who could cover this class',
  })
  async candidates(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.assistant.substituteCandidates(id, actor) };
  }

  @Post('classes/:id/substitutes')
  @HttpCode(201)
  @RequireFeature('classes.substitutes')
  @Audit('classes.substitute.granted', 'Class')
  @ApiOperation({
    summary: 'Give a teacher or assistant access to this class until a date',
  })
  addSubstitute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubstituteDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assistant.addSubstitute(id, dto, actor);
  }

  @Delete('substitutes/:id')
  @HttpCode(204)
  @RequireFeature('classes.substitutes')
  @Audit('classes.substitute.revoked', 'SubstituteAccess')
  async removeSubstitute(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.assistant.removeSubstitute(id, actor);
  }

  @Get('planner')
  @RequireFeature('planner.view')
  @ApiOperation({
    summary:
      'The week for my classes: due dates, events, term boundaries and scheduled plans',
  })
  planner(@Query() q: PlannerQuery, @CurrentUser() actor: AuthenticatedUser) {
    return this.assistant.planner(q.week, actor);
  }
}
