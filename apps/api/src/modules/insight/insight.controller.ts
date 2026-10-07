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
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  RequireAnyFeature,
  RequireFeature,
} from '../access/decorators/access.decorators';
import { Audit } from '../audit/audit.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  CreateScheduleDto,
  OverviewQuery,
  ReportQuery,
  UpdateScheduleDto,
} from './dto/insight.dto';
import { REPORT_KINDS, type ReportKind } from './insight-rules';
import { InsightService } from './insight.service';

@ApiTags('Insight')
@ApiBearerAuth('bearer')
@Controller()
export class InsightController {
  constructor(private readonly insight: InsightService) {}

  @Get('organizations/:organizationId/insight/overview')
  @RequireFeature('reports.view')
  @ApiOperation({
    summary:
      'Principal dashboard: attendance today, missing work by grade, failing by class, gradebook completeness, AI usage, engagement',
  })
  overview(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query() q: OverviewQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.insight.overview(organizationId, actor, q.date);
  }

  @Get('organizations/:organizationId/insight/reports/:kind.csv')
  @RequireFeature('reports.view')
  @Audit('insight.report.csv', 'Organization')
  @ApiOperation({ summary: 'One of the scheduled report kinds, now, as CSV' })
  async reportCsv(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('kind') kind: string,
    @Query() q: ReportQuery,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const known = (REPORT_KINDS as readonly string[]).includes(kind)
      ? (kind as ReportKind)
      : 'school_overview';
    const out = await this.insight.reportCsv(
      organizationId,
      known,
      actor,
      q.classId,
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${out.fileName}"`,
    );
    res.send(out.csv);
  }

  @Get('organizations/:organizationId/report-schedules')
  @RequireFeature('reports.schedule')
  async schedules(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return {
      data: await this.insight.schedules(organizationId, actor),
      kinds: REPORT_KINDS,
    };
  }

  @Post('organizations/:organizationId/report-schedules')
  @HttpCode(201)
  @RequireFeature('reports.schedule')
  @Audit('insight.schedule.create', 'ReportSchedule')
  createSchedule(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateScheduleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.insight.createSchedule(organizationId, dto, actor);
  }

  @Patch('report-schedules/:id')
  @RequireFeature('reports.schedule')
  @Audit('insight.schedule.update', 'ReportSchedule')
  updateSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateScheduleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.insight.updateSchedule(id, dto, actor);
  }

  @Delete('report-schedules/:id')
  @HttpCode(204)
  @RequireFeature('reports.schedule')
  @Audit('insight.schedule.delete', 'ReportSchedule')
  async removeSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.insight.removeSchedule(id, actor);
  }

  @Get('report-schedules/:id/runs')
  @RequireFeature('reports.schedule')
  async runs(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.insight.runs(id, actor) };
  }

  @Post('report-schedules/:id/run')
  @HttpCode(200)
  @RequireFeature('reports.schedule')
  @Audit('insight.schedule.run', 'ReportSchedule')
  @ApiOperation({
    summary:
      'Build and email the report now; says whether a mail transport delivered it',
  })
  runNow(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.insight.runNow(id, actor);
  }

  @Get('classes/:id/insight')
  @RequireFeature('reports.view')
  @ApiOperation({
    summary:
      'Grade distribution, attendance, missing work, at-risk list and assignment averages for one class',
  })
  classInsight(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.insight.classInsight(id, actor);
  }

  @Get('students/:id/insight')
  @RequireAnyFeature('reports.view', 'family.view')
  @ApiOperation({
    summary:
      "One student's classes, attendance, missing work, weekly activity, AI and practice; family, teachers, counselors, administrators",
  })
  studentInsight(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.insight.studentInsight(id, actor);
  }

  @Get('students/:id/transcript.pdf')
  @RequireAnyFeature(
    'reports.view',
    'report-cards.view.own',
    'report-cards.view.child',
  )
  @ApiOperation({
    summary:
      'PDF transcript from published report cards, with per-year and cumulative GPA',
  })
  async transcript(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const pdf = await this.insight.transcriptPdf(id, actor);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="transcript-${id}.pdf"`,
    );
    res.send(pdf);
  }
}
