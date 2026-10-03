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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireFeature } from '../access/decorators/access.decorators';
import { Audit } from '../audit/audit.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  AttendanceCodeDto,
  CreateAcademicYearDto,
  CreateBellScheduleDto,
  CreateGradingPeriodDto,
  CreatePeriodDto,
  CreateTermDto,
  SchoolSettingsDto,
  UpdateAcademicYearDto,
  UpdateAttendanceCodeDto,
  UpdatePeriodDto,
  UpdateTermDto,
} from './dto/school.dto';
import { SchoolService } from './school.service';

/** School structure for one organisation (docs/13 sections 3 and 5): readable by members, edited by administrators. */
@ApiTags('School structure')
@ApiBearerAuth('bearer')
@Controller('organizations/:organizationId/structure')
export class SchoolController {
  constructor(private readonly school: SchoolService) {}

  @Get()
  @RequireFeature('classes.view')
  @ApiOperation({
    summary:
      'Years, terms, grading periods, bell schedules, attendance codes, grade levels, deadline',
  })
  structure(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.school.structure(organizationId, actor);
  }

  @Put('settings')
  @RequireFeature('organizations.structure')
  @Audit('organizations.settings.update', 'Organization')
  settings(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: SchoolSettingsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.school.setSettings(organizationId, dto, actor);
  }

  @Post('years')
  @HttpCode(201)
  @RequireFeature('organizations.structure')
  createYear(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateAcademicYearDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.school.createYear(organizationId, dto, actor);
  }

  @Patch('years/:id')
  @RequireFeature('organizations.structure')
  updateYear(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAcademicYearDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.school.updateYear(organizationId, id, dto, actor);
  }

  @Delete('years/:id')
  @HttpCode(204)
  @RequireFeature('organizations.structure')
  async removeYear(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.school.removeYear(organizationId, id, actor);
  }

  @Post('years/:yearId/terms')
  @HttpCode(201)
  @RequireFeature('organizations.structure')
  createTerm(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('yearId', ParseUUIDPipe) yearId: string,
    @Body() dto: CreateTermDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.school.createTerm(organizationId, yearId, dto, actor);
  }

  @Patch('terms/:id')
  @RequireFeature('organizations.structure')
  updateTerm(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTermDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.school.updateTerm(organizationId, id, dto, actor);
  }

  @Delete('terms/:id')
  @HttpCode(204)
  @RequireFeature('organizations.structure')
  async removeTerm(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.school.removeTerm(organizationId, id, actor);
  }

  @Post('terms/:termId/grading-periods')
  @HttpCode(201)
  @RequireFeature('organizations.structure')
  createGradingPeriod(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('termId', ParseUUIDPipe) termId: string,
    @Body() dto: CreateGradingPeriodDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.school.createGradingPeriod(organizationId, termId, dto, actor);
  }

  @Delete('grading-periods/:id')
  @HttpCode(204)
  @RequireFeature('organizations.structure')
  async removeGradingPeriod(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.school.removeGradingPeriod(organizationId, id, actor);
  }

  @Post('bell-schedules')
  @HttpCode(201)
  @RequireFeature('organizations.structure')
  createBellSchedule(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateBellScheduleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.school.createBellSchedule(organizationId, dto, actor);
  }

  @Delete('bell-schedules/:id')
  @HttpCode(204)
  @RequireFeature('organizations.structure')
  async removeBellSchedule(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.school.removeBellSchedule(organizationId, id, actor);
  }

  @Post('bell-schedules/:scheduleId/periods')
  @HttpCode(201)
  @RequireFeature('organizations.structure')
  createPeriod(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @Body() dto: CreatePeriodDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.school.createPeriod(organizationId, scheduleId, dto, actor);
  }

  @Patch('periods/:id')
  @RequireFeature('organizations.structure')
  updatePeriod(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePeriodDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.school.updatePeriod(organizationId, id, dto, actor);
  }

  @Delete('periods/:id')
  @HttpCode(204)
  @RequireFeature('organizations.structure')
  async removePeriod(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.school.removePeriod(organizationId, id, actor);
  }

  @Get('attendance-codes')
  @RequireFeature('classes.view')
  @ApiOperation({
    summary: 'Attendance codes (the standard set is created on first use)',
  })
  async codes(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.school.codes(organizationId, actor) };
  }

  @Post('attendance-codes')
  @HttpCode(201)
  @RequireFeature('organizations.structure')
  createCode(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: AttendanceCodeDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.school.createCode(organizationId, dto, actor);
  }

  @Patch('attendance-codes/:id')
  @RequireFeature('organizations.structure')
  updateCode(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAttendanceCodeDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.school.updateCode(organizationId, id, dto, actor);
  }
}
