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
  Put,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { RequireFeature } from '../access/decorators/access.decorators';
import { Audit } from '../audit/audit.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  CreateRosterSourceDto,
  ImportCsvQuery,
  RunSourceDto,
  SsoSettingsDto,
  UpdateRosterSourceDto,
} from './dto/roster.dto';
import { RosterService } from './roster.service';

/** Rostering and sign-in configuration for one organisation (docs/13 section 2). Administrators only. */
@ApiTags('Rostering')
@ApiBearerAuth('bearer')
@Controller('organizations/:organizationId/roster')
export class RosterController {
  constructor(private readonly roster: RosterService) {}

  @Get('sources')
  @RequireFeature('organizations.roster')
  async listSources(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.roster.listSources(organizationId, actor) };
  }

  @Post('sources')
  @HttpCode(201)
  @RequireFeature('organizations.roster')
  @Audit('roster.source.create', 'RosterSource')
  @ApiOperation({
    summary:
      'Connect a OneRoster API, ClassLink or Clever source (secrets stored encrypted)',
  })
  createSource(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateRosterSourceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.roster.createSource(organizationId, dto, actor);
  }

  @Patch('sources/:id')
  @RequireFeature('organizations.roster')
  updateSource(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRosterSourceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.roster.updateSource(organizationId, id, dto, actor);
  }

  @Delete('sources/:id')
  @HttpCode(204)
  @RequireFeature('organizations.roster')
  async removeSource(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.roster.removeSource(organizationId, id, actor);
  }

  @Post('sources/:id/run')
  @HttpCode(202)
  @RequireFeature('organizations.roster')
  @ApiOperation({ summary: 'Sync now (dryRun to preview); poll the run' })
  runSource(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RunSourceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.roster.runSource(
      organizationId,
      id,
      dto.dryRun === true,
      actor,
    );
  }

  @Post('import')
  @HttpCode(202)
  @RequireFeature('organizations.roster')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Import a OneRoster 1.1 CSV bundle: a zip or the CSV files in field "files"; ?dryRun=true previews',
  })
  @UseInterceptors(
    FilesInterceptor('files', 12, {
      storage: memoryStorage(),
      limits: { fileSize: 200 * 1024 * 1024 },
    }),
  )
  importCsv(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @UploadedFiles() files: Array<{ originalname: string; buffer: Buffer }>,
    @Query() q: ImportCsvQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.roster.importCsv(
      organizationId,
      files ?? [],
      q.dryRun === true,
      actor,
    );
  }

  @Get('runs')
  @RequireFeature('organizations.roster')
  async listRuns(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.roster.listRuns(organizationId, actor) };
  }

  @Get('runs/:id')
  @RequireFeature('organizations.roster')
  @ApiOperation({ summary: 'A run with its counts and up to 200 errors' })
  getRun(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.roster.getRun(organizationId, id, actor);
  }

  @Get('sso')
  @RequireFeature('organizations.roster')
  getSso(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.roster.getSso(organizationId, actor);
  }

  @Put('sso')
  @RequireFeature('organizations.roster')
  @Audit('organizations.sso.update', 'Organization')
  @ApiOperation({
    summary:
      'Which sign-in providers this organisation accepts, for which email domains',
  })
  setSso(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: SsoSettingsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.roster.setSso(organizationId, dto, actor);
  }
}
