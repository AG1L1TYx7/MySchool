import {
  BadRequestException,
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
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { RequireFeature } from '../access/decorators/access.decorators';
import { Audit } from '../audit/audit.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  AddGuardianDto,
  CreateStudentDto,
  ImportStudentsDto,
  ListStudentsQuery,
  UpdateGuardianDto,
  UpdateStudentDto,
} from './dto/students.dto';
import { StudentsService } from './students.service';

@ApiTags('Students')
@ApiBearerAuth('bearer')
@Controller('students')
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Get()
  @RequireFeature('students.view')
  @ApiOperation({ summary: 'List students (search, grade, status, sort)' })
  list(@Query() q: ListStudentsQuery, @CurrentUser() actor: AuthenticatedUser) {
    return this.students.list(q, actor);
  }

  @Get('mine')
  @RequireFeature('profile.view')
  @ApiOperation({
    summary: 'Own student record (students) or linked children (parents)',
  })
  async mine(@CurrentUser() actor: AuthenticatedUser) {
    return { data: await this.students.mine(actor) };
  }

  @Get('export')
  @RequireFeature('students.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiProduces('text/csv')
  @ApiOperation({
    summary:
      'Export students in scope as CSV (same columns as the import template)',
  })
  async exportCsv(
    @Query() q: ListStudentsQuery,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const csv = await this.students.exportCsv(q, actor);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="students-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(csv);
  }

  @Get('import/template')
  @RequireFeature('students.import')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="students-template.csv"')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'CSV template for bulk import' })
  template(): string {
    return this.students.importTemplate();
  }

  @Post('import')
  @HttpCode(200)
  @RequireFeature('students.import')
  @Audit('students.import', 'Student')
  @ApiConsumes('application/json', 'text/csv')
  @ApiBody({ type: ImportStudentsDto })
  @ApiOperation({
    summary:
      'Bulk import from CSV; upserts by student number, links guardians, reports per-line errors. ?dryRun=true validates only.',
  })
  import(
    @Body() body: ImportStudentsDto | string | undefined,
    @Query('dryRun') dryRun: string | undefined,
    @Query('organizationId') organizationId: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const raw: Partial<ImportStudentsDto> =
      typeof body === 'string' ? { csv: body } : (body ?? {});
    const dto: ImportStudentsDto = {
      csv: raw.csv ?? '',
      dryRun: raw.dryRun ?? dryRun === 'true',
      organizationId: raw.organizationId ?? organizationId,
    };
    if (typeof dto.csv !== 'string' || dto.csv.trim() === '')
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Provide CSV text (JSON { csv } or a text/csv body).',
      });
    return this.students.import(dto, actor);
  }

  @Post()
  @HttpCode(201)
  @RequireFeature('students.create')
  @Audit('students.create', 'Student')
  @ApiOperation({
    summary: 'Create a student record, optionally with a sign-in account',
  })
  create(
    @Body() dto: CreateStudentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.students.create(dto, actor);
  }

  @Get(':id')
  @RequireFeature('students.view')
  @ApiOperation({ summary: 'Get one student' })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.students.get(id, actor);
  }

  @Patch(':id')
  @RequireFeature('students.edit')
  @Audit('students.update', 'Student')
  @ApiOperation({ summary: 'Update a student' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.students.update(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireFeature('students.delete')
  @Audit('students.delete', 'Student')
  @ApiOperation({ summary: 'Soft-delete (withdraw) a student' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.students.remove(id, actor);
  }

  @Get(':id/guardians')
  @RequireFeature('profile.view')
  @ApiOperation({
    summary:
      'Guardians linked to a student (staff, the student, or their guardians)',
  })
  async guardians(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.students.guardians(id, actor) };
  }

  @Post(':id/guardians')
  @HttpCode(201)
  @RequireFeature('students.guardians.manage')
  @Audit('students.guardian_added', 'Student')
  @ApiOperation({
    summary:
      'Link a guardian by user id or email; unknown emails get a parent account and an invitation',
  })
  addGuardian(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddGuardianDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.students.addGuardian(id, dto, actor);
  }

  @Patch(':id/guardians/:guardianId')
  @RequireFeature('students.guardians.manage')
  @Audit('students.guardian_updated', 'Student')
  @ApiOperation({
    summary:
      'Change relationship, primary contact or permissions of a guardian link',
  })
  updateGuardian(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
    @Body() dto: UpdateGuardianDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.students.updateGuardian(id, guardianId, dto, actor);
  }

  @Delete(':id/guardians/:guardianId')
  @HttpCode(204)
  @RequireFeature('students.guardians.manage')
  @Audit('students.guardian_removed', 'Student')
  @ApiOperation({ summary: 'Unlink a guardian' })
  async removeGuardian(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.students.removeGuardian(id, guardianId, actor);
  }
}
