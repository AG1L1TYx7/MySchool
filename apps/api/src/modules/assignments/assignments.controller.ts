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
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  RequireAnyFeature,
  RequireFeature,
} from '../access/decorators/access.decorators';
import { Audit } from '../audit/audit.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AssignmentsService } from './assignments.service';
import {
  CreateAssignmentDto,
  CreateRubricDto,
  GradeSubmissionDto,
  ListAssignmentsQuery,
  ListGradesQuery,
  SubmitDto,
  UpdateAssignmentDto,
  UpdateRubricDto,
} from './dto/assignments.dto';
import { RubricsService } from './rubrics.service';

@ApiTags('Assignments')
@ApiBearerAuth('bearer')
@Controller('assignments')
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get()
  @RequireFeature('assignments.view')
  @ApiOperation({
    summary:
      'List assignments (students and parents: published work in their classes, with their own status)',
  })
  list(
    @Query() q: ListAssignmentsQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assignments.list(q, actor);
  }

  @Post()
  @HttpCode(201)
  @RequireFeature('assignments.create')
  @Audit('assignments.create', 'Assignment')
  @ApiOperation({ summary: 'Create a draft assignment in a class you manage' })
  create(
    @Body() dto: CreateAssignmentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assignments.create(dto, actor);
  }

  @Get(':id')
  @RequireFeature('assignments.view')
  @ApiOperation({
    summary: 'Assignment detail (students: with their own submissions)',
  })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assignments.get(id, actor);
  }

  @Patch(':id')
  @RequireFeature('assignments.edit')
  @Audit('assignments.update', 'Assignment')
  @ApiOperation({ summary: 'Update an assignment' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssignmentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assignments.update(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireFeature('assignments.delete')
  @Audit('assignments.delete', 'Assignment')
  @ApiOperation({ summary: 'Delete an ungraded assignment' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.assignments.remove(id, actor);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequireFeature('assignments.edit')
  @Audit('assignments.publish', 'Assignment')
  @ApiOperation({ summary: 'Publish to students' })
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assignments.setStatus(id, 'PUBLISHED', actor);
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequireFeature('assignments.edit')
  @Audit('assignments.close', 'Assignment')
  @ApiOperation({ summary: 'Close: no further submissions' })
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assignments.setStatus(id, 'CLOSED', actor);
  }

  @Get(':id/submissions')
  @RequireFeature('assignments.grade')
  @ApiOperation({
    summary: 'Every enrolled student with their latest submission and grade',
  })
  async submissions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.assignments.submissions(id, actor) };
  }

  @Post(':id/submissions')
  @HttpCode(201)
  @RequireFeature('assignments.submit')
  @Audit('submissions.create', 'Assignment')
  @ApiOperation({
    summary:
      'Submit text and/or uploaded file ids; the attempt number is assigned',
  })
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assignments.submit(id, dto, actor);
  }
}

@ApiTags('Assignments')
@ApiBearerAuth('bearer')
@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get(':id')
  @RequireFeature('assignments.view')
  @ApiOperation({
    summary:
      'One submission (the student, their guardians, or staff managing the class)',
  })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assignments.getSubmission(id, actor);
  }

  @Post(':id/grade')
  @HttpCode(200)
  @RequireFeature('assignments.grade')
  @Audit('grades.post', 'AssignmentSubmission')
  @ApiOperation({
    summary:
      'Grade a submission: score, feedback, rubric scores; late penalty applied unless waived',
  })
  grade(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GradeSubmissionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assignments.grade(id, dto, actor);
  }
}

@ApiTags('Grades')
@ApiBearerAuth('bearer')
@Controller('grades')
export class GradesController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get()
  @RequireAnyFeature('grades.view.all', 'grades.view.own', 'grades.view.child')
  @ApiOperation({
    summary:
      'Grades: all in scope for staff, own for students, children for parents',
  })
  list(@Query() q: ListGradesQuery, @CurrentUser() actor: AuthenticatedUser) {
    return this.assignments.listGrades(q, actor);
  }
}

@ApiTags('Grades')
@ApiBearerAuth('bearer')
@Controller('classes')
export class GradebookController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get(':id/gradebook')
  @RequireFeature('grades.view.all')
  @ApiOperation({
    summary: 'Gradebook matrix with weighted totals, letters and averages',
  })
  gradebook(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assignments.gradebook(id, actor);
  }

  @Get(':id/gradebook/export')
  @RequireFeature('grades.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Gradebook as CSV' })
  async exportCsv(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const csv = await this.assignments.gradebookCsv(id, actor);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="gradebook-${id}.csv"`,
    );
    res.send(csv);
  }
}

@ApiTags('Assignments')
@ApiBearerAuth('bearer')
@Controller('rubrics')
export class RubricsController {
  constructor(private readonly rubrics: RubricsService) {}

  @Get()
  @RequireFeature('assignments.view')
  @ApiOperation({ summary: 'Rubrics in the organisation' })
  async list(
    @Query('search') search: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.rubrics.list(actor, search) };
  }

  @Post()
  @HttpCode(201)
  @RequireFeature('rubrics.manage')
  @Audit('rubrics.create', 'Rubric')
  @ApiOperation({ summary: 'Create a rubric' })
  create(
    @Body() dto: CreateRubricDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.rubrics.create(dto, actor);
  }

  @Get(':id')
  @RequireFeature('assignments.view')
  @ApiOperation({ summary: 'One rubric' })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.rubrics.get(id, actor);
  }

  @Patch(':id')
  @RequireFeature('rubrics.manage')
  @Audit('rubrics.update', 'Rubric')
  @ApiOperation({ summary: 'Update a rubric' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRubricDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.rubrics.update(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireFeature('rubrics.manage')
  @Audit('rubrics.delete', 'Rubric')
  @ApiOperation({ summary: 'Delete a rubric' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.rubrics.remove(id, actor);
  }
}
