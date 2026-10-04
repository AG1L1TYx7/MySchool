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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import {
  RequireAnyFeature,
  RequireFeature,
} from '../access/decorators/access.decorators';
import { Audit } from '../audit/audit.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  AccommodationDto,
  AiConsentDto,
  BehaviorRecordDto,
  CaseloadDto,
  CounselorNoteDto,
  ListWellnessQuery,
  SupportSettingsDto,
  UpdateBehaviorRecordDto,
  WellnessUpdateDto,
} from './dto/support.dto';
import { SupportService } from './support.service';

class CounselorQuery {
  @IsOptional() @IsUUID() counselorId?: string;
}

@ApiTags('Support')
@ApiBearerAuth('bearer')
@Controller('students/:studentId')
export class StudentSupportController {
  constructor(private readonly support: SupportService) {}

  @Get('accommodations')
  @RequireAnyFeature(
    'support.accommodations.view',
    'support.accommodations.manage',
  )
  @ApiOperation({
    summary:
      "A student's IEP or 504 accommodations (the student's teachers, counselors, administrators, family)",
  })
  accommodation(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.support.accommodation(studentId, actor);
  }

  @Put('accommodations')
  @RequireFeature('support.accommodations.manage')
  @Audit('support.accommodation.set', 'Student')
  setAccommodation(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: AccommodationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.support.setAccommodation(studentId, dto, actor);
  }

  @Delete('accommodations')
  @HttpCode(204)
  @RequireFeature('support.accommodations.manage')
  async removeAccommodation(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.support.removeAccommodation(studentId, actor);
  }

  @Get('counselor-notes')
  @RequireFeature('support.notes')
  @ApiOperation({
    summary:
      'Private counselor notes; never visible to teachers, parents or students',
  })
  async notes(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.support.notes(studentId, actor) };
  }

  @Post('counselor-notes')
  @HttpCode(201)
  @RequireFeature('support.notes')
  addNote(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: CounselorNoteDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.support.addNote(studentId, dto, actor);
  }

  @Get('behavior')
  @RequireAnyFeature('support.behavior.view', 'support.behavior.manage')
  @ApiOperation({
    summary: 'Behaviour records; families see what the school rule allows',
  })
  async behavior(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.support.behavior(studentId, actor) };
  }

  @Post('behavior')
  @HttpCode(201)
  @RequireFeature('support.behavior.manage')
  @Audit('support.behavior.create', 'Student')
  addBehavior(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: BehaviorRecordDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.support.addBehavior(studentId, dto, actor);
  }

  @Get('ai-consent')
  @RequireAnyFeature('support.consent.view', 'support.consent.manage')
  @ApiOperation({
    summary:
      'COPPA consent for AI features: under-13 status, school default, parent decision, whether AI is allowed',
  })
  aiConsent(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.support.aiConsent(studentId, actor);
  }

  @Put('ai-consent')
  @RequireFeature('support.consent.manage')
  @Audit('support.ai_consent.set', 'Student')
  @ApiOperation({
    summary:
      'A parent grants or declines (opt-out); administrators may record the school decision',
  })
  setAiConsent(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: AiConsentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.support.setAiConsent(studentId, dto, actor);
  }
}

@ApiTags('Support')
@ApiBearerAuth('bearer')
@Controller()
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get('me/accommodations')
  @RequireFeature('profile.view')
  @ApiOperation({
    summary:
      'The flags the signed-in student’s screens apply (larger text, reduced motion, read aloud, reduced distraction)',
  })
  mine(@CurrentUser() actor: AuthenticatedUser) {
    return this.support.myAccommodations(actor);
  }

  @Get('counselor/caseload')
  @RequireFeature('support.counselor')
  async caseload(
    @Query() q: CounselorQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.support.caseload(actor, q.counselorId) };
  }

  @Post('counselor/caseload')
  @HttpCode(204)
  @RequireFeature('support.counselor')
  async addToCaseload(
    @Body() dto: CaseloadDto,
    @Query() q: CounselorQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.support.addToCaseload(dto, actor, q.counselorId);
  }

  @Delete('counselor/caseload/:studentId')
  @HttpCode(204)
  @RequireFeature('support.counselor')
  async removeFromCaseload(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() q: CounselorQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.support.removeFromCaseload(studentId, actor, q.counselorId);
  }

  @Patch('counselor-notes/:id')
  @RequireFeature('support.notes')
  updateNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CounselorNoteDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.support.updateNote(id, dto, actor);
  }

  @Delete('counselor-notes/:id')
  @HttpCode(204)
  @RequireFeature('support.notes')
  async removeNote(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.support.removeNote(id, actor);
  }

  @Get('wellness/alerts')
  @RequireFeature('wellness.alerts')
  @ApiOperation({
    summary: 'The wellness queue: tutor escalations waiting for a counselor',
  })
  alerts(
    @Query() q: ListWellnessQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.support.alerts(q, actor);
  }

  @Patch('wellness/alerts/:id')
  @RequireFeature('wellness.alerts')
  @Audit('wellness.alert.update', 'WellnessAlert')
  updateAlert(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WellnessUpdateDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.support.updateAlert(id, dto, actor);
  }

  @Patch('behavior/:id')
  @RequireFeature('support.behavior.manage')
  updateBehavior(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBehaviorRecordDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.support.updateBehavior(id, dto, actor);
  }

  @Delete('behavior/:id')
  @HttpCode(204)
  @RequireFeature('support.behavior.manage')
  @Audit('support.behavior.delete', 'BehaviorRecord')
  async removeBehavior(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.support.removeBehavior(id, actor);
  }

  @Get('organizations/:organizationId/support/settings')
  @RequireFeature('classes.view')
  settings(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.support.settings(organizationId, actor);
  }

  @Put('organizations/:organizationId/support/settings')
  @RequireFeature('organizations.structure')
  @Audit('support.settings.update', 'Organization')
  @ApiOperation({
    summary:
      'Behaviour visibility for families, the under-13 AI consent default, and whether students may message classmates',
  })
  setSettings(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: SupportSettingsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.support.setSettings(organizationId, dto, actor);
  }
}
