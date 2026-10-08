import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FileUpload } from '../../generated/prisma/client';
import { newId } from '../../common/utils/ids';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ROLE_LEVEL } from '../access/roles';
import { isDistrictRole } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  extensionOf,
  isAllowedExtension,
  sanitizeFilename,
  storagePath,
} from './file-rules';

export interface PublicFile {
  id: string;
  organizationId: string | null;
  uploaderId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  category: string;
  createdAt: Date;
  downloadUrl: string;
}

export interface IncomingFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const CATEGORIES = ['general', 'submission', 'avatar', 'resource'] as const;

/**
 * Local-disk file storage (docs/02 section 10). Files live outside the web root under
 * UPLOAD_DIR/<org>/<yyyy>/<mm>/<id>.<ext>; only metadata is in the database.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async store(
    file: IncomingFile | undefined,
    category: string | undefined,
    actor: AuthenticatedUser,
  ): Promise<PublicFile> {
    if (!file)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: "Send the file in a multipart field named 'file'.",
      });
    const maxBytes = this.config.get('MAX_FILE_SIZE_MB') * 1024 * 1024;
    if (file.size > maxBytes)
      throw new PayloadTooLargeException({
        code: 'file.too_large',
        detail: `Files may be at most ${this.config.get('MAX_FILE_SIZE_MB')} MB.`,
      });
    const originalName = sanitizeFilename(file.originalname);
    const ext = extensionOf(originalName);
    if (!isAllowedExtension(ext, this.config.get('ALLOWED_EXTENSIONS'))) {
      throw new BadRequestException({
        code: 'file.type_not_allowed',
        detail: `Files of type '${ext || 'unknown'}' are not accepted.`,
      });
    }
    const cat =
      category && (CATEGORIES as readonly string[]).includes(category)
        ? category
        : 'general';
    const id = newId();
    const relative = storagePath(actor.organizationId, id, ext);
    const absolute = path.resolve(this.config.get('UPLOAD_DIR'), relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, file.buffer, { flag: 'wx' });
    const row = await this.prisma.fileUpload.create({
      data: {
        id,
        organizationId: actor.organizationId,
        uploaderId: actor.id,
        originalName,
        storedPath: relative,
        mimeType: (file.mimetype || 'application/octet-stream').slice(0, 127),
        sizeBytes: file.size,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        category: cat,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'files.upload',
      entityType: 'FileUpload',
      entityId: id,
      details: { originalName, sizeBytes: file.size, category: cat },
    });
    return toPublic(row);
  }

  async get(id: string, actor: AuthenticatedUser): Promise<PublicFile> {
    return toPublic(await this.findAccessible(id, actor));
  }

  async download(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<{ absolutePath: string; file: PublicFile }> {
    const row = await this.findAccessible(id, actor);
    return {
      absolutePath: path.resolve(this.config.get('UPLOAD_DIR'), row.storedPath),
      file: toPublic(row),
    };
  }

  /** Where a stored file lives, for callers that have already decided the person may have it (the library). */
  async pathFor(
    id: string,
  ): Promise<{ absolutePath: string; fileName: string; mimeType: string }> {
    const row = await this.prisma.fileUpload.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'File not found.',
      });
    return {
      absolutePath: path.resolve(this.config.get('UPLOAD_DIR'), row.storedPath),
      fileName: row.originalName,
      mimeType: row.mimeType,
    };
  }

  /** Soft delete in the database; the bytes are removed best-effort. */
  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const row = await this.prisma.fileUpload.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'File not found.',
      });
    const manager = await this.hasFeature(actor, 'files.manage');
    if (
      row.uploaderId !== actor.id &&
      !(manager && sameOrganization(row, actor))
    ) {
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Only the uploader or a file manager can delete this file.',
      });
    }
    const linked = await this.prisma.submissionFile.count({
      where: { fileId: id },
    });
    if (linked > 0)
      throw new BadRequestException({
        code: 'file.in_use',
        detail: 'This file is attached to a submission and cannot be deleted.',
      });
    await this.prisma.fileUpload.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await fs
      .unlink(path.resolve(this.config.get('UPLOAD_DIR'), row.storedPath))
      .catch((err: unknown) =>
        this.logger.warn(
          `Could not remove ${row.storedPath}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'files.delete',
      entityType: 'FileUpload',
      entityId: id,
    });
  }

  /** Files a student attaches to a submission must be their own, live, and in the submission category. */
  toPublic(f: FileUpload): PublicFile {
    return toPublic(f);
  }

  async assertOwnedFiles(
    fileIds: string[],
    actor: AuthenticatedUser,
  ): Promise<void> {
    if (fileIds.length === 0) return;
    const count = await this.prisma.fileUpload.count({
      where: { id: { in: fileIds }, uploaderId: actor.id, deletedAt: null },
    });
    if (count !== new Set(fileIds).size)
      throw new BadRequestException({
        code: 'file.not_owned',
        detail: 'One or more files are missing or were not uploaded by you.',
      });
  }

  /**
   * Who may read a file: the uploader, a file manager in the same organisation, staff of the
   * same organisation, and guardians of a student whose submission contains it.
   */
  private async findAccessible(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<FileUpload> {
    const row = await this.prisma.fileUpload.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'File not found.',
      });
    if (row.uploaderId === actor.id || isDistrictRole(actor)) return row;
    if (
      sameOrganization(row, actor) &&
      (ROLE_LEVEL[actor.role] >= ROLE_LEVEL.TEACHER ||
        actor.role === 'ASSISTANT')
    )
      return row;
    // A file manager reaches every file of their own organisation, never another school's (security pass 3).
    if (
      sameOrganization(row, actor) &&
      (await this.hasFeature(actor, 'files.manage'))
    )
      return row;
    const viaMessage = await this.prisma.messageFile.count({
      where: {
        fileId: id,
        message: {
          conversation: {
            participants: { some: { userId: actor.id, leftAt: null } },
          },
        },
      },
    });
    if (viaMessage > 0) return row;
    if (actor.role === 'PARENT') {
      const viaChild = await this.prisma.submissionFile.count({
        where: {
          fileId: id,
          submission: {
            student: { guardians: { some: { guardianUserId: actor.id } } },
          },
        },
      });
      if (viaChild > 0) return row;
    }
    throw new ForbiddenException({
      code: 'authz.forbidden',
      detail: 'You do not have access to this file.',
    });
  }

  private async hasFeature(
    actor: AuthenticatedUser,
    code: string,
  ): Promise<boolean> {
    const rows = await this.prisma.roleFeature.count({
      where: { role: actor.role, feature: { code, isActive: true } },
    });
    if (rows > 0) return true;
    const override = await this.prisma.userFeatureOverride.findFirst({
      where: { userId: actor.id, isGranted: true, feature: { code } },
      select: { id: true },
    });
    return override !== null;
  }
}

function sameOrganization(row: FileUpload, actor: AuthenticatedUser): boolean {
  return (
    row.organizationId !== null && row.organizationId === actor.organizationId
  );
}

export function toPublic(f: FileUpload): PublicFile {
  return {
    id: f.id,
    organizationId: f.organizationId,
    uploaderId: f.uploaderId,
    originalName: f.originalName,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    sha256: f.sha256,
    category: f.category,
    createdAt: f.createdAt,
    downloadUrl: `/api/v1/files/${f.id}/download`,
  };
}
