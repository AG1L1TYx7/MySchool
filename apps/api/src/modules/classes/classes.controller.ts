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
import { ClassesService } from './classes.service';
import {
  AddTeacherDto,
  CreateClassDto,
  EnrollDto,
  ListClassesQuery,
  UpdateClassDto,
  UpdateEnrollmentDto,
} from './dto/classes.dto';

@ApiTags('Classes')
@ApiBearerAuth('bearer')
@Controller('classes')
export class ClassesController {
  constructor(private readonly classes: ClassesService) {}

  @Get()
  @RequireFeature('classes.view')
  @ApiOperation({
    summary: 'List classes (students and parents see only their own)',
  })
  list(@Query() q: ListClassesQuery, @CurrentUser() actor: AuthenticatedUser) {
    return this.classes.list(q, actor);
  }

  @Get('mine')
  @RequireFeature('profile.view')
  @ApiOperation({
    summary: 'Classes I teach or attend (parents: my children attend)',
  })
  async mine(@CurrentUser() actor: AuthenticatedUser) {
    return { data: await this.classes.mine(actor) };
  }

  @Post()
  @HttpCode(201)
  @RequireFeature('classes.create')
  @Audit('classes.create', 'Class')
  @ApiOperation({ summary: 'Create a class for a course and term' })
  create(@Body() dto: CreateClassDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.classes.create(dto, actor);
  }

  @Get(':id')
  @RequireFeature('classes.view')
  @ApiOperation({ summary: 'Class with course, teachers and roster counts' })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.classes.get(id, actor);
  }

  @Patch(':id')
  @RequireFeature('classes.edit')
  @Audit('classes.update', 'Class')
  @ApiOperation({
    summary: 'Update class details (assigned teachers and administrators)',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClassDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.classes.update(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireFeature('classes.delete')
  @Audit('classes.delete', 'Class')
  @ApiOperation({ summary: 'Cancel and soft-delete a class' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.classes.remove(id, actor);
  }

  @Post(':id/teachers')
  @HttpCode(200)
  @RequireFeature('classes.teachers.manage')
  @Audit('classes.teacher_added', 'Class')
  @ApiOperation({ summary: 'Assign a teacher (primary or co-teacher)' })
  addTeacher(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddTeacherDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.classes.addTeacher(id, dto, actor);
  }

  @Delete(':id/teachers/:teacherId')
  @HttpCode(204)
  @RequireFeature('classes.teachers.manage')
  @Audit('classes.teacher_removed', 'Class')
  @ApiOperation({ summary: 'Unassign a teacher' })
  async removeTeacher(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('teacherId', ParseUUIDPipe) teacherId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.classes.removeTeacher(id, teacherId, actor);
  }

  @Get(':id/enrollments')
  @RequireFeature('classes.roster.manage')
  @ApiOperation({
    summary: 'Roster: enrolled, waitlisted, dropped and completed students',
  })
  async roster(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.classes.roster(id, actor) };
  }

  @Post(':id/enrollments')
  @HttpCode(200)
  @RequireFeature('classes.roster.manage')
  @Audit('classes.enroll', 'Class')
  @ApiOperation({
    summary: 'Enrol students; beyond capacity they are waitlisted',
  })
  enroll(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnrollDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.classes.enroll(id, dto, actor);
  }

  @Patch(':id/enrollments/:studentId')
  @RequireFeature('classes.roster.manage')
  @Audit('classes.enrollment_updated', 'Class')
  @ApiOperation({
    summary: 'Change an enrolment status (capacity is enforced when enrolling)',
  })
  updateEnrollment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: UpdateEnrollmentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.classes.updateEnrollment(id, studentId, dto.status, actor);
  }

  @Delete(':id/enrollments/:studentId')
  @HttpCode(204)
  @RequireFeature('classes.roster.manage')
  @Audit('classes.enrollment_dropped', 'Class')
  @ApiOperation({
    summary: 'Drop a student from the class (the record is kept as dropped)',
  })
  async drop(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.classes.drop(id, studentId, actor);
  }
}

@ApiTags('Classes')
@ApiBearerAuth('bearer')
@Controller('students')
export class StudentClassesController {
  constructor(private readonly classes: ClassesService) {}

  @Get(':studentId/classes')
  @RequireFeature('profile.view')
  @ApiOperation({
    summary:
      "A student's classes with enrolment status (staff, the student, or their guardians)",
  })
  async forStudent(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.classes.forStudent(studentId, actor) };
  }
}
