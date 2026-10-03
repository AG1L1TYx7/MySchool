import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
  CreateSetDto,
  CreateStandardDto,
  ImportCaseDto,
  ListSetsQuery,
  ListStandardsQuery,
} from './dto/standards.dto';
import { StandardsService } from './standards.service';

@ApiTags('Standards')
@ApiBearerAuth('bearer')
@Controller('standards')
export class StandardsController {
  constructor(private readonly standards: StandardsService) {}

  @Get('sets')
  @RequireFeature('standards.view')
  @ApiOperation({
    summary: "Standard sets visible to me: shared ones and my district's",
  })
  async sets(
    @Query() q: ListSetsQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.standards.sets(q.organizationId, actor) };
  }

  @Post('sets')
  @HttpCode(201)
  @RequireFeature('standards.manage')
  @Audit('standards.set.create', 'StandardSet')
  createSet(
    @Body() dto: CreateSetDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.standards.createSet(dto, actor);
  }

  @Post('sets/import')
  @HttpCode(201)
  @RequireFeature('standards.manage')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Import a 1EdTech CASE package (JSON file in field "file")',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  importCase(
    @UploadedFile() file: { originalname: string; buffer: Buffer } | undefined,
    @Body() dto: ImportCaseDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!file)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Attach the CASE JSON file in field "file".',
      });
    let json: unknown;
    try {
      json = JSON.parse(file.buffer.toString('utf8'));
    } catch {
      throw new BadRequestException({
        code: 'standards.invalid_case',
        detail: 'The file is not valid JSON.',
      });
    }
    return this.standards.importCase(json, dto, actor);
  }

  @Post('sets/:id/standards')
  @HttpCode(201)
  @RequireFeature('standards.manage')
  createStandard(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateStandardDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.standards.createStandard(id, dto, actor);
  }

  @Delete('sets/:id')
  @HttpCode(204)
  @RequireFeature('standards.manage')
  @Audit('standards.set.delete', 'StandardSet')
  async removeSet(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.standards.removeSet(id, actor);
  }

  @Get()
  @RequireFeature('standards.view')
  @ApiOperation({ summary: 'Search standards by set, grade level and text' })
  list(
    @Query() q: ListStandardsQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.standards.list(q, actor);
  }
}
