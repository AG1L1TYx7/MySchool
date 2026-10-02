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
import {
  ApiBearerAuth,
  ApiExcludeController,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  RequireAnyFeature,
  RequireFeature,
} from '../access/decorators/access.decorators';
import { Audit } from '../audit/audit.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import {
  CreateH5pContentDto,
  ListH5pQueryDto,
  RecordResultDto,
  UpdateH5pContentDto,
} from './dto/h5p.dto';
import { H5pService } from './h5p.service';

@ApiTags('Interactive content')
@ApiBearerAuth('bearer')
@Controller('h5p')
export class H5pController {
  constructor(private readonly h5p: H5pService) {}

  @Get('libraries')
  @RequireFeature('h5p.view')
  @ApiOperation({ summary: 'Libraries the player can run' })
  libraries() {
    return { data: this.h5p.libraries() };
  }

  @Get('contents')
  @RequireFeature('h5p.view')
  @ApiOperation({
    summary:
      'Interactive content in the organisation (learners see published only)',
  })
  async list(
    @Query() q: ListH5pQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.h5p.list(q, actor) };
  }

  @Post('contents')
  @HttpCode(201)
  @RequireFeature('h5p.create')
  @Audit('h5p.content.create', 'H5PContent')
  @ApiOperation({
    summary: 'Create content from library parameters (validated)',
  })
  create(
    @Body() dto: CreateH5pContentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.h5p.create(dto, actor);
  }

  @Get('contents/:id')
  @RequireFeature('h5p.view')
  @ApiOperation({
    summary: 'Content with parameters, the AI draft and validation state',
  })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.h5p.get(id, actor);
  }

  @Patch('contents/:id')
  @RequireFeature('h5p.edit')
  @Audit('h5p.content.update', 'H5PContent')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateH5pContentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.h5p.update(id, dto, actor);
  }

  @Post('contents/:id/publish')
  @HttpCode(200)
  @RequireFeature('h5p.edit')
  @ApiOperation({
    summary: 'Make the content available to students (after review)',
  })
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.h5p.setStatus(id, 'PUBLISHED', actor);
  }

  @Post('contents/:id/unpublish')
  @HttpCode(200)
  @RequireFeature('h5p.edit')
  unpublish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.h5p.setStatus(id, 'DRAFT', actor);
  }

  @Delete('contents/:id')
  @HttpCode(204)
  @RequireFeature('h5p.edit')
  @Audit('h5p.content.delete', 'H5PContent')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.h5p.remove(id, actor);
  }

  @Get('contents/:id/play')
  @RequireFeature('h5p.view')
  @ApiOperation({
    summary:
      'A short-lived play ticket and the package path for the browser player',
  })
  play(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('assignmentId') assignmentId: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.h5p.play(id, actor, assignmentId || undefined);
  }

  @Post('contents/:id/results')
  @HttpCode(201)
  @RequireFeature('h5p.view')
  @ApiOperation({
    summary:
      'Record a play result; with assignmentId it becomes a submission and an auto-posted grade',
  })
  record(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordResultDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.h5p.recordResult(id, dto, actor);
  }

  @Get('contents/:id/results')
  @RequireAnyFeature('h5p.results.view', 'h5p.view')
  @ApiOperation({ summary: 'Results (staff: everyone; learners: their own)' })
  async results(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.h5p.results(id, actor) };
  }
}

/** Package files the standalone player fetches with the ticket instead of a bearer token. */
@ApiExcludeController()
@Public()
@Controller('h5p/play')
export class H5pPlayController {
  constructor(private readonly h5p: H5pService) {}

  @Get(':ticket/h5p.json')
  manifest(@Param('ticket') ticket: string) {
    return this.h5p.manifest(ticket);
  }

  @Get(':ticket/content/content.json')
  content(@Param('ticket') ticket: string) {
    return this.h5p.contentJson(ticket);
  }
}
