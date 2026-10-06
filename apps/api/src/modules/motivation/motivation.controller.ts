import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireFeature } from '../access/decorators/access.decorators';
import { Audit } from '../audit/audit.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  AwardDto,
  CreateQuestDto,
  MotivationSettingsDto,
} from './dto/motivation.dto';
import { BADGES } from './motivation-rules';
import { MotivationService } from './motivation.service';

@ApiTags('Motivation')
@ApiBearerAuth('bearer')
@Controller()
export class MotivationController {
  constructor(private readonly motivation: MotivationService) {}

  @Get('me/motivation')
  @RequireFeature('motivation.view')
  @ApiOperation({
    summary:
      'The signed-in student: XP, level, title, streak, badges, quests and recent rewards (private)',
  })
  mine(@CurrentUser() actor: AuthenticatedUser) {
    return this.motivation.mine(actor);
  }

  @Get('students/:id/motivation')
  @RequireFeature('motivation.view')
  @ApiOperation({
    summary:
      "A student's motivation summary for their family, teachers, counselors and administrators",
  })
  forStudent(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.motivation.forStudent(id, actor);
  }

  @Post('students/:id/motivation/awards')
  @HttpCode(201)
  @RequireFeature('motivation.award')
  @Audit('motivation.award', 'Student')
  @ApiOperation({ summary: 'Award XP or a badge with a reason (teachers)' })
  award(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AwardDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.motivation.award(id, dto, actor);
  }

  @Get('classes/:id/motivation')
  @RequireFeature('motivation.award')
  @ApiOperation({
    summary:
      'Teacher console: each student’s level, streak and badges, who is near a milestone, class quests; no ranking',
  })
  classConsole(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.motivation.classConsole(id, actor);
  }

  @Get('classes/:id/quests')
  @RequireFeature('motivation.view')
  @ApiOperation({
    summary:
      'Class quests: the class total and the caller’s own contribution, never other students’',
  })
  async classQuests(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.motivation.classQuests(id, actor) };
  }

  @Post('classes/:id/quests')
  @HttpCode(201)
  @RequireFeature('motivation.award')
  @Audit('motivation.quest.created', 'Class')
  createQuest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateQuestDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.motivation.createClassQuest(id, dto, actor);
  }

  @Delete('quests/:id')
  @HttpCode(204)
  @RequireFeature('motivation.award')
  async removeQuest(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.motivation.removeQuest(id, actor);
  }

  @Post('lessons/:id/complete')
  @HttpCode(200)
  @RequireFeature('motivation.view')
  @ApiOperation({
    summary: 'A student marks a lesson finished (XP once per lesson)',
  })
  completeLesson(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.motivation.completeLesson(id, actor);
  }

  @Get('courses/:id/progress')
  @RequireFeature('motivation.view')
  @ApiOperation({
    summary:
      'Progress map: modules and lessons with what is finished and the next step; studentId for a child or a student you teach',
  })
  progress(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('studentId') studentId: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.motivation.progress(id, actor, studentId);
  }

  @Get('badges')
  @RequireFeature('motivation.view')
  @ApiOperation({ summary: 'The badge catalogue' })
  badges() {
    return { data: BADGES };
  }

  @Get('organizations/:organizationId/motivation/settings')
  @RequireFeature('motivation.view')
  settings(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.motivation.settings(organizationId, actor);
  }

  @Put('organizations/:organizationId/motivation/settings')
  @RequireFeature('organizations.structure')
  @Audit('motivation.settings', 'Organization')
  updateSettings(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: MotivationSettingsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.motivation.updateSettings(organizationId, dto, actor);
  }
}
