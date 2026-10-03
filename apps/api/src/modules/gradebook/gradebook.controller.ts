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
  Put,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
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
  ClassGradingDto,
  CreateCategoryDto,
  CreateScaleDto,
  SetMarkDto,
  UpdateCategoryDto,
  UpdateScaleDto,
} from './dto/gradebook.dto';
import { GradebookService } from './gradebook.service';

@ApiTags('Grades')
@ApiBearerAuth('bearer')
@Controller('classes/:classId')
export class ClassGradingController {
  constructor(private readonly gradebook: GradebookService) {}

  @Get('grading')
  @RequireFeature('classes.view')
  @ApiOperation({
    summary:
      'Grading settings of a class: mode, categories, late policy and syllabus (members and staff)',
  })
  grading(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.gradebook.grading(classId, actor);
  }

  @Put('grading')
  @RequireFeature('grades.edit')
  @Audit('grading.settings.update', 'Class')
  setGrading(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() dto: ClassGradingDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.gradebook.setGrading(classId, dto, actor);
  }

  @Post('grading/categories')
  @HttpCode(201)
  @RequireFeature('grades.edit')
  createCategory(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() dto: CreateCategoryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.gradebook.createCategory(classId, dto, actor);
  }

  @Patch('grading/categories/:id')
  @RequireFeature('grades.edit')
  updateCategory(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.gradebook.updateCategory(classId, id, dto, actor);
  }

  @Delete('grading/categories/:id')
  @HttpCode(204)
  @RequireFeature('grades.edit')
  async removeCategory(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.gradebook.removeCategory(classId, id, actor);
  }

  @Get('gradebook')
  @RequireFeature('grades.view.all')
  @ApiOperation({
    summary:
      'Gradebook: weighted categories, drop-lowest, extra credit, marks; standards levels for standards-based classes',
  })
  book(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.gradebook.gradebook(classId, actor);
  }

  @Get('gradebook/export')
  @RequireFeature('grades.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Gradebook as CSV' })
  async exportCsv(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const csv = await this.gradebook.gradebookCsv(classId, actor);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="gradebook-${classId}.csv"`,
    );
    res.send(csv);
  }
}

@ApiTags('Grades')
@ApiBearerAuth('bearer')
@Controller('assignments/:assignmentId/marks')
export class MarksController {
  constructor(private readonly gradebook: GradebookService) {}

  @Put(':studentId')
  @RequireFeature('assignments.grade')
  @ApiOperation({
    summary:
      'Set a mark for one student: missing, excused, incomplete, or null to clear',
  })
  set(
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: SetMarkDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.gradebook.setMark(assignmentId, studentId, dto, actor);
  }
}

@ApiTags('Grades')
@ApiBearerAuth('bearer')
@Controller('organizations/:organizationId/proficiency-scales')
export class ProficiencyScalesController {
  constructor(private readonly gradebook: GradebookService) {}

  @Get()
  @RequireFeature('classes.view')
  list(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.gradebook
      .scales(organizationId, actor)
      .then((data) => ({ data }));
  }

  @Post()
  @HttpCode(201)
  @RequireFeature('organizations.structure')
  create(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateScaleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.gradebook.createScale(organizationId, dto, actor);
  }

  @Patch(':id')
  @RequireFeature('organizations.structure')
  update(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateScaleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.gradebook.updateScale(organizationId, id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireFeature('organizations.structure')
  async remove(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.gradebook.removeScale(organizationId, id, actor);
  }
}
