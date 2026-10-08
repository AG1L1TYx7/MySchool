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
  Put,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RequireFeature } from '../access/decorators/access.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CareersService } from './careers.service';
import {
  ChecklistTickDto,
  CreateCodeLessonDto,
  CreateSkillDto,
  EndorseDto,
  InventoryDto,
  ProjectDto,
  ReviewProjectDto,
  RunCodeDto,
  SetSkillDto,
  UpdateCareerDto,
  UpdatePortfolioDto,
  UpdateProjectDto,
} from './dto/careers.dto';

@ApiTags('Careers and portfolio')
@ApiBearerAuth('bearer')
@Controller()
export class CareersController {
  constructor(private readonly careers: CareersService) {}

  // Portfolio ------------------------------------------------------------------

  @Get('me/portfolio')
  @RequireFeature('portfolio.view')
  @ApiOperation({
    summary: 'My portfolio with every project (any state) and my skills',
  })
  myPortfolio(@CurrentUser() actor: AuthenticatedUser) {
    return this.careers.myPortfolio(actor);
  }

  @Patch('me/portfolio')
  @RequireFeature('portfolio.view')
  @ApiOperation({
    summary:
      'Headline, about, visibility (private | family | school | public) and public address',
  })
  updatePortfolio(
    @Body() dto: UpdatePortfolioDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.careers.updatePortfolio(dto, actor);
  }

  @Get('me/portfolio/evidence')
  @RequireFeature('portfolio.view')
  @ApiOperation({
    summary: 'My submissions that a project may point at as evidence',
  })
  evidence(@CurrentUser() actor: AuthenticatedUser) {
    return this.careers.evidence(actor);
  }

  @Post('me/portfolio/projects')
  @RequireFeature('portfolio.view')
  @ApiOperation({ summary: 'Add a project (draft unless status is published)' })
  createProject(
    @Body() dto: ProjectDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.careers.createProject(dto, actor);
  }

  @Patch('me/portfolio/projects/:id')
  @RequireFeature('portfolio.view')
  @ApiOperation({
    summary: 'Change a project; fileIds replaces the media list',
  })
  updateProject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.careers.updateProject(id, dto, actor);
  }

  @Delete('me/portfolio/projects/:id')
  @HttpCode(204)
  @RequireFeature('portfolio.view')
  @ApiOperation({ summary: 'Remove a project' })
  removeProject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.careers.removeProject(id, actor);
  }

  @Post('me/portfolio/projects/:id/reviews/:reviewId/hide')
  @RequireFeature('portfolio.view')
  @ApiOperation({ summary: 'Hide a piece of feedback from my project page' })
  hideReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.careers.hideReview(id, reviewId, actor);
  }

  @Get('students/:id/portfolio')
  @RequireFeature('portfolio.view')
  @ApiOperation({
    summary:
      "A student's portfolio (family, their teachers and school staff always; others by its visibility)",
  })
  portfolio(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.careers.portfolio(id, actor);
  }

  @Post('portfolio/projects/:id/reviews')
  @RequireFeature('portfolio.review')
  @ApiOperation({
    summary:
      'Leave feedback on a published project (one per person; replaced on repeat)',
  })
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewProjectDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.careers.reviewProject(id, dto, actor);
  }

  @Get('p/:slug')
  @Public()
  @ApiOperation({ summary: 'A public portfolio by its address, no sign-in' })
  publicPortfolio(@Param('slug') slug: string) {
    return this.careers.publicPortfolio(slug);
  }

  // Skills ---------------------------------------------------------------------

  @Get('skills')
  @RequireFeature('portfolio.view')
  @ApiOperation({
    summary:
      "The skill catalogue: the platform set plus this school's additions",
  })
  skills(@CurrentUser() actor: AuthenticatedUser) {
    return this.careers.skillCatalogue(actor);
  }

  @Post('skills')
  @RequireFeature('portfolio.skills.manage')
  @ApiOperation({ summary: 'Add a school skill to the catalogue' })
  createSkill(
    @Body() dto: CreateSkillDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.careers.createSkill(dto, actor);
  }

  @Put('me/skills')
  @RequireFeature('portfolio.view')
  @ApiOperation({
    summary: 'Add or change one of my skills: { skillId, level 1..4, note? }',
  })
  setSkill(@Body() dto: SetSkillDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.careers.setSkill(dto, actor);
  }

  @Delete('me/skills/:skillId')
  @RequireFeature('portfolio.view')
  @ApiOperation({ summary: 'Remove one of my skills' })
  removeSkill(
    @Param('skillId', ParseUUIDPipe) skillId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.careers.removeSkill(skillId, actor);
  }

  @Post('students/:id/skills/:skillId/endorse')
  @RequireFeature('portfolio.review')
  @ApiOperation({
    summary:
      'Endorse a skill (teachers, counselors, administrators and classmates; once each)',
  })
  endorse(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('skillId', ParseUUIDPipe) skillId: string,
    @Body() dto: EndorseDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.careers.endorse(id, skillId, dto, actor);
  }

  // Career and college -----------------------------------------------------------

  @Get('career/inventory')
  @RequireFeature('career.view')
  @ApiOperation({ summary: 'The interest inventory statements and scale' })
  inventory() {
    return this.careers.inventoryQuestions();
  }

  @Get('career/clusters')
  @RequireFeature('career.view')
  @ApiOperation({ summary: 'The sixteen career clusters with example careers' })
  clusters() {
    return this.careers.clusters();
  }

  @Get('me/career')
  @RequireFeature('career.view')
  @ApiOperation({
    summary:
      'My career profile: goals, interests, pathways, college plans and the readiness checklist',
  })
  myCareer(@CurrentUser() actor: AuthenticatedUser) {
    return this.careers.myCareer(actor);
  }

  @Post('me/career/inventory')
  @RequireFeature('career.view')
  @ApiOperation({
    summary:
      'Answer the inventory: { answers: { statementId: 1..5 } } -> scores, top codes, matching clusters',
  })
  takeInventory(
    @Body() dto: InventoryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.careers.takeInventory(dto, actor);
  }

  @Get('students/:id/career')
  @RequireFeature('career.view')
  @ApiOperation({
    summary:
      "A student's career profile (family, their teachers, counselors and administrators)",
  })
  career(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.careers.career(id, actor);
  }

  @Patch('students/:id/career')
  @RequireFeature('career.view')
  @ApiOperation({
    summary:
      'Goals, pathways and college plans (the student or their counselor)',
  })
  updateCareer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCareerDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.careers.updateCareer(id, dto, actor);
  }

  @Post('students/:id/career/checklist')
  @RequireFeature('career.view')
  @ApiOperation({
    summary:
      'Tick or untick a readiness item: { key, done } (students their own items, counselors any)',
  })
  tick(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChecklistTickDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.careers.tickChecklist(id, dto, actor);
  }

  // Resume -----------------------------------------------------------------------

  @Get('students/:id/resume')
  @RequireFeature('portfolio.view')
  @ApiOperation({ summary: 'The resume content as data' })
  resume(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.careers.resumeData(id, actor);
  }

  @Get('students/:id/resume.pdf')
  @RequireFeature('portfolio.view')
  @ApiOperation({ summary: 'The resume as a PDF (audited)' })
  async resumePdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const out = await this.careers.resumePdf(id, actor);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${out.fileName}"`,
    );
    res.send(out.buffer);
  }

  // Code lessons -----------------------------------------------------------------

  @Get('code/lessons')
  @RequireFeature('code.learn')
  @ApiOperation({ summary: 'Code lessons with my best result per lesson' })
  codeLessons(@CurrentUser() actor: AuthenticatedUser) {
    return this.careers.codeLessons(actor);
  }

  @Post('code/lessons')
  @RequireFeature('code.manage')
  @ApiOperation({
    summary:
      'Add a school code lesson: { title, description, level?, starter, tests: [{ expr, expected }] }',
  })
  createCodeLesson(
    @Body() dto: CreateCodeLessonDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.careers.createCodeLesson(dto, actor);
  }

  @Get('code/lessons/:id')
  @RequireFeature('code.learn')
  @ApiOperation({
    summary: 'One lesson with its starter, tests and my last submission',
  })
  codeLesson(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.careers.codeLesson(id, actor);
  }

  @Post('code/lessons/:id/run')
  @RequireFeature('code.learn')
  @ApiOperation({
    summary:
      'Run my code against the tests in the sandbox and record the attempt',
  })
  runCode(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RunCodeDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.careers.runCode(id, dto, actor);
  }

  @Get('students/:id/code/progress')
  @RequireFeature('code.learn')
  @ApiOperation({ summary: "A student's code lesson progress" })
  codeProgress(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.careers.codeProgress(id, actor);
  }
}
