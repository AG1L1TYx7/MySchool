import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { RequireFeature } from '../access/decorators/access.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AttendanceReportsService } from './attendance-reports.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

class StatusQuery {
  @IsOptional() @Matches(DATE) date?: string;
}
class ExportQuery {
  @Matches(DATE) from!: string;
  @Matches(DATE) to!: string;
  @IsOptional() @IsIn(['ada', 'chronic']) type?: 'ada' | 'chronic';
}

@ApiTags('Attendance')
@ApiBearerAuth('bearer')
@Controller('organizations/:organizationId/attendance')
export class AttendanceReportsController {
  constructor(private readonly reports: AttendanceReportsService) {}

  @Get('status')
  @RequireFeature('attendance.view')
  @ApiOperation({
    summary:
      'Which classes meeting on a date have taken attendance, and which have not',
  })
  status(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query() q: StatusQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.reports.takenStatus(
      organizationId,
      q.date ?? new Date().toISOString().slice(0, 10),
      actor,
    );
  }

  @Get('export')
  @RequireFeature('attendance.report')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({
    summary:
      'CSV: average daily attendance per student (type=ada) or the chronic absenteeism list (type=chronic)',
  })
  export(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query() q: ExportQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.reports.exportCsv(
      organizationId,
      q.from,
      q.to,
      q.type ?? 'ada',
      actor,
    );
  }
}
