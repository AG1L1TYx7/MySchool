import {
  Body,
  Controller,
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
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  ListNotificationsQuery,
  SetPreferencesDto,
} from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth('bearer')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequireFeature('notifications.view')
  @ApiOperation({ summary: 'My notifications (unreadOnly, category, page)' })
  list(
    @Query() q: ListNotificationsQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.notifications.list(q, actor);
  }

  @Get('summary')
  @RequireFeature('notifications.view')
  @ApiOperation({
    summary: 'Unread count by category and the latest few (for the bell)',
  })
  summary(@CurrentUser() actor: AuthenticatedUser) {
    return this.notifications.summary(actor);
  }

  @Get('preferences')
  @RequireFeature('notifications.view')
  async preferences(@CurrentUser() actor: AuthenticatedUser) {
    return { data: await this.notifications.preferences(actor) };
  }

  @Put('preferences')
  @RequireFeature('notifications.manage')
  @ApiOperation({ summary: 'Per-category in-app and email switches' })
  async setPreferences(
    @Body() dto: SetPreferencesDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.notifications.setPreferences(dto, actor) };
  }

  @Post('read-all')
  @HttpCode(200)
  @RequireFeature('notifications.view')
  markAll(@CurrentUser() actor: AuthenticatedUser) {
    return this.notifications.markAllRead(actor);
  }

  @Post(':id/read')
  @HttpCode(200)
  @RequireFeature('notifications.view')
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.notifications.markRead(id, actor);
  }
}
