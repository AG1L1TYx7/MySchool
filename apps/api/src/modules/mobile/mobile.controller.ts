import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireFeature } from '../access/decorators/access.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MobileService } from './mobile.service';

/** Compact, compressed responses for phones; the same permissions as the full API. */
@ApiTags('Mobile')
@ApiBearerAuth('bearer')
@Controller('mobile')
export class MobileController {
  constructor(private readonly mobile: MobileService) {}

  @Get('home')
  @RequireFeature('dashboard.view')
  @ApiOperation({
    summary:
      'The first screen in one call: today, work due, unread, attendance to take, XP, children, announcements',
  })
  home(@CurrentUser() actor: AuthenticatedUser) {
    return this.mobile.home(actor);
  }

  @Get('sync')
  @RequireFeature('dashboard.view')
  @ApiOperation({
    summary:
      'Changes since a cursor for offline caching; returns the next cursor',
  })
  sync(
    @Query('since') since: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.mobile.sync(actor, since);
  }

  @Get('classes')
  @RequireFeature('classes.view')
  classes(@CurrentUser() actor: AuthenticatedUser) {
    return this.mobile.classesList(actor);
  }

  @Get('assignments')
  @RequireFeature('assignments.view')
  assignments(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.mobile.assignmentsList(
      actor,
      Math.max(1, Number(page) || 1),
      Math.min(100, Math.max(1, Number(pageSize) || 25)),
    );
  }

  @Get('grades')
  @RequireFeature('dashboard.view')
  grades(@CurrentUser() actor: AuthenticatedUser) {
    return this.mobile.gradesList(actor);
  }

  @Get('attendance')
  @RequireFeature('dashboard.view')
  attendance(
    @Query('days') days: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.mobile.attendanceList(
      actor,
      Math.min(180, Math.max(1, Number(days) || 30)),
    );
  }
}
