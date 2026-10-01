import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { RequireFeature } from '../access/decorators/access.decorators';
import { Audit } from '../audit/audit.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { contentDisposition } from './file-rules';
import { FilesService, type IncomingFile } from './files.service';

/** Hard cap at the HTTP layer; the configured MAX_FILE_SIZE_MB is enforced in the service. */
const HARD_LIMIT_BYTES = 50 * 1024 * 1024;

@ApiTags('Files')
@ApiBearerAuth('bearer')
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @HttpCode(201)
  @RequireFeature('files.upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: HARD_LIMIT_BYTES, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        category: {
          type: 'string',
          enum: ['general', 'submission', 'avatar', 'resource'],
        },
      },
    },
  })
  @ApiOperation({
    summary:
      'Upload one file (multipart field "file"); extension allowlist and size limit apply',
  })
  upload(
    @UploadedFile() file: IncomingFile | undefined,
    @Query('category') category: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.files.store(file, category, actor);
  }

  @Get(':id')
  @RequireFeature('profile.view')
  @ApiOperation({ summary: 'File metadata' })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.files.get(id, actor);
  }

  @Get(':id/download')
  @RequireFeature('profile.view')
  @ApiOperation({ summary: 'Download the file bytes' })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const { absolutePath, file } = await this.files.download(id, actor);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', contentDisposition(file.originalName));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(absolutePath);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireFeature('files.upload')
  @Audit('files.delete', 'FileUpload')
  @ApiOperation({
    summary: 'Delete a file you uploaded (or any file with files.manage)',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.files.remove(id, actor);
  }
}
