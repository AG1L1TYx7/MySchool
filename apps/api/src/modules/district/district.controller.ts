import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RequireFeature } from '../access/decorators/access.decorators';
import { Audit } from '../audit/audit.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  DISTRICT_REPORT_KINDS,
  STATE_EXPORT_KINDS,
  type DistrictReportKind,
  type StateExportKind,
} from '../tenants/tenant-rules';
import { DistrictService } from './district.service';

@ApiTags('District')
@ApiBearerAuth('bearer')
@Controller('district')
export class DistrictController {
  constructor(private readonly district: DistrictService) {}

  @Get('overview')
  @RequireFeature('district.view')
  @ApiOperation({
    summary:
      'Every school of the district on one page, with totals; the platform administrator may name a tenantId',
  })
  overview(
    @Query('tenantId') tenantId: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.district.overview(actor, tenantId || undefined);
  }

  @Get('reports/:kind.csv')
  @RequireFeature('district.view')
  @Audit('district.report.csv', 'Tenant')
  @ApiOperation({
    summary:
      'Cross-school CSV: schools | enrollment_by_grade | attendance_daily | ai_usage',
  })
  async report(
    @Param('kind') kind: string,
    @Query('tenantId') tenantId: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const known = (DISTRICT_REPORT_KINDS as readonly string[]).includes(kind)
      ? (kind as DistrictReportKind)
      : 'schools';
    const out = await this.district.report(known, actor, tenantId || undefined);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${out.fileName}"`,
    );
    res.send(out.csv);
  }

  @Get('state-exports/:kind.csv')
  @RequireFeature('district.manage')
  @ApiOperation({
    summary:
      'State reporting export, student level: enrollment | attendance | discipline | grades (?year= for grades); audited',
  })
  async stateExport(
    @Param('kind') kind: string,
    @Query('tenantId') tenantId: string | undefined,
    @Query('year') year: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const known = (STATE_EXPORT_KINDS as readonly string[]).includes(kind)
      ? (kind as StateExportKind)
      : 'enrollment';
    const out = await this.district.stateExport(
      known,
      actor,
      tenantId || undefined,
      year || undefined,
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${out.fileName}"`,
    );
    res.send(out.csv);
  }
}
