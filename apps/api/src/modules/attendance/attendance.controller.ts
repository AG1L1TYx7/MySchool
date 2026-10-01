import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  RequireAnyFeature,
  RequireFeature,
} from '../access/decorators/access.decorators';
import { Audit } from '../audit/audit.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AttendanceService } from './attendance.service';
import {
  BulkAttendanceDto,
  ListAttendanceQuery,
  MarkAttendanceDto,
  SummaryQuery,
  UpdateAttendanceDto,
} from './dto/attendance.dto';

@ApiTags('Attendance')
@ApiBearerAuth('bearer')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get()
  @RequireAnyFeature(
    'attendance.view',
    'attendance.view.own',
    'attendance.view.child',
  )
  @ApiOperation({
    summary:
      'Attendance records: class or organisation for staff, own for students, children for parents',
  })
  list(
    @Query() q: ListAttendanceQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.attendance.list(q, actor);
  }

  @Post()
  @HttpCode(200)
  @RequireFeature('attendance.mark')
  @Audit('attendance.mark', 'Attendance')
  @ApiOperation({ summary: 'Mark one student for one day (upsert)' })
  mark(
    @Body() dto: MarkAttendanceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.attendance.mark(dto, actor);
  }

  @Post('bulk')
  @HttpCode(200)
  @RequireFeature('attendance.mark')
  @Audit('attendance.bulk', 'Class')
  @ApiOperation({ summary: 'Mark a class for one day (upsert per student)' })
  bulk(
    @Body() dto: BulkAttendanceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.attendance.bulk(dto, actor);
  }

  @Patch(':id')
  @RequireFeature('attendance.edit')
  @Audit('attendance.update', 'Attendance')
  @ApiOperation({ summary: 'Correct a record' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAttendanceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.attendance.update(id, dto, actor);
  }
}

@ApiTags('Attendance')
@ApiBearerAuth('bearer')
@Controller('classes')
export class ClassAttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get(':id/attendance/summary')
  @RequireFeature('attendance.view')
  @ApiOperation({
    summary: 'Per-student counts and rates for a class over a date range',
  })
  summary(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: SummaryQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.attendance.classSummary(id, q.from, q.to, actor);
  }
}

@ApiTags('Attendance')
@ApiBearerAuth('bearer')
@Controller('students')
export class StudentAttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get(':id/attendance/summary')
  @RequireAnyFeature(
    'attendance.view',
    'attendance.view.own',
    'attendance.view.child',
  )
  @ApiOperation({
    summary: "A student's attendance counts overall and per class",
  })
  summary(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: SummaryQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.attendance.studentSummary(id, q.from, q.to, actor);
  }
}
