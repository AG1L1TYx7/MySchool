import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { PagedQueryDto } from '../../common/dto/paged-response.dto';
import { RequireFeature } from '../access/decorators/access.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from './audit.service';

export class AuditLogsQuery extends PagedQueryDto {
  @IsOptional() @IsString() @MaxLength(36) userId?: string;
  @IsOptional() @IsString() @MaxLength(100) action?: string;
  @IsOptional() @IsString() @MaxLength(100) entityType?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

@ApiTags('Audit')
@ApiBearerAuth('bearer')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequireFeature('audit.logs.view')
  @ApiOperation({
    summary:
      "Query the audit trail (scoped to the caller's organisation unless SuperAdmin)",
  })
  list(@Query() q: AuditLogsQuery, @CurrentUser() actor: AuthenticatedUser) {
    const scope = actor.role === 'SUPER_ADMIN' ? null : actor.organizationId;
    return this.audit.query(q, scope);
  }

  @Get('export.csv')
  @RequireFeature('audit.logs.view')
  @ApiOperation({ summary: 'The filtered audit trail as CSV (audited)' })
  async exportCsv(
    @Query() q: AuditLogsQuery,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const scope = actor.role === 'SUPER_ADMIN' ? null : actor.organizationId;
    const csv = await this.audit.exportCsv(q, scope, actor);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(csv);
  }
}
