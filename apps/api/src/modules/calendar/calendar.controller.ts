import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireFeature } from '../access/decorators/access.decorators';
import { Audit } from '../audit/audit.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CalendarService } from './calendar.service';
import { CreateEventDto, FeedQuery, UpdateEventDto } from './dto/calendar.dto';

@ApiTags('Calendar')
@ApiBearerAuth('bearer')
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  @RequireFeature('calendar.view')
  @ApiOperation({
    summary:
      'My calendar between two dates: school and class events, assignment due dates, term boundaries',
  })
  async feed(@Query() q: FeedQuery, @CurrentUser() actor: AuthenticatedUser) {
    return { data: await this.calendar.feed(q, actor) };
  }

  @Post('events')
  @HttpCode(201)
  @RequireFeature('calendar.manage')
  @Audit('calendar.event.create', 'CalendarEvent')
  @ApiOperation({
    summary:
      'Add an event (teachers: for a class they teach; administrators: school-wide)',
  })
  create(@Body() dto: CreateEventDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.calendar.create(dto, actor);
  }

  @Patch('events/:id')
  @RequireFeature('calendar.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.calendar.update(id, dto, actor);
  }

  @Delete('events/:id')
  @HttpCode(204)
  @RequireFeature('calendar.manage')
  @Audit('calendar.event.delete', 'CalendarEvent')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.calendar.remove(id, actor);
  }

  @Get('subscription')
  @RequireFeature('calendar.view')
  @ApiOperation({
    summary: 'My private iCal subscription URL (rotate=true issues a new one)',
  })
  async subscription(
    @Query('rotate') rotate: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const token = await this.calendar.icalToken(actor, rotate === 'true');
    return { path: `/api/v1/calendar/ical/${token}.ics` };
  }
}

/** Calendar apps fetch this with the private token; no bearer token is possible there. */
@Public()
@Controller('calendar/ical')
export class CalendarFeedController {
  constructor(private readonly calendar: CalendarService) {}

  @Get(':token.ics')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Cache-Control', 'private, max-age=300')
  ical(@Param('token') token: string) {
    return this.calendar.ical(token);
  }
}
