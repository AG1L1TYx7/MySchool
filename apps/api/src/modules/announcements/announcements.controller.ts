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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireFeature } from '../access/decorators/access.decorators';
import { Audit } from '../audit/audit.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AnnouncementsService } from './announcements.service';
import {
  CreateAnnouncementDto,
  ListAnnouncementsQuery,
  UpdateAnnouncementDto,
} from './dto/announcements.dto';

@ApiTags('Announcements')
@ApiBearerAuth('bearer')
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  @RequireFeature('announcements.view')
  @ApiOperation({
    summary:
      'Feed: pinned first, then urgency, then newest; learners see published items for their school and classes',
  })
  list(
    @Query() q: ListAnnouncementsQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.announcements.list(q, actor);
  }

  @Post()
  @HttpCode(201)
  @RequireFeature('announcements.create')
  @Audit('announcements.create', 'Announcement')
  @ApiOperation({
    summary:
      'Create (teachers: for a class they teach; administrators: school-wide too); publish=true posts at once',
  })
  create(
    @Body() dto: CreateAnnouncementDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.announcements.create(dto, actor);
  }

  @Get(':id')
  @RequireFeature('announcements.view')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.announcements.get(id, actor);
  }

  @Patch(':id')
  @RequireFeature('announcements.edit')
  @Audit('announcements.update', 'Announcement')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAnnouncementDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.announcements.update(id, dto, actor);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequireFeature('announcements.edit')
  @ApiOperation({
    summary:
      'Publish: notifies the class (teachers, students, guardians) or the whole school',
  })
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.announcements.publish(id, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireFeature('announcements.edit')
  @Audit('announcements.delete', 'Announcement')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.announcements.remove(id, actor);
  }
}
