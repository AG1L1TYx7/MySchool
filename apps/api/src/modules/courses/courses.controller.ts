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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireFeature } from '../access/decorators/access.decorators';
import { Audit } from '../audit/audit.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CoursesService } from './courses.service';
import {
  CreateCourseDto,
  CreateLessonDto,
  CreateModuleDto,
  ListCoursesQuery,
  ReorderDto,
  SetPrerequisitesDto,
  UpdateCourseDto,
  UpdateLessonDto,
  UpdateModuleDto,
} from './dto/courses.dto';

@ApiTags('Curriculum')
@ApiBearerAuth('bearer')
@Controller('courses')
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get()
  @RequireFeature('courses.view')
  @ApiOperation({
    summary: 'List courses (students and parents see published courses only)',
  })
  list(@Query() q: ListCoursesQuery, @CurrentUser() actor: AuthenticatedUser) {
    return this.courses.list(q, actor);
  }

  @Post()
  @HttpCode(201)
  @RequireFeature('courses.create')
  @Audit('courses.create', 'Course')
  @ApiOperation({ summary: 'Create a draft course' })
  create(
    @Body() dto: CreateCourseDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.courses.create(dto, actor);
  }

  @Get(':id')
  @RequireFeature('courses.view')
  @ApiOperation({ summary: 'Course with modules, lessons and prerequisites' })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.courses.get(id, actor);
  }

  @Patch(':id')
  @RequireFeature('courses.edit')
  @Audit('courses.update', 'Course')
  @ApiOperation({ summary: 'Update course details or status' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCourseDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.courses.update(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireFeature('courses.delete')
  @Audit('courses.delete', 'Course')
  @ApiOperation({
    summary: 'Archive (soft-delete) a course with no live classes',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.courses.remove(id, actor);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequireFeature('courses.edit')
  @Audit('courses.publish', 'Course')
  @ApiOperation({ summary: 'Publish: visible to students, status active' })
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.courses.setPublished(id, true, actor);
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @RequireFeature('courses.edit')
  @Audit('courses.unpublish', 'Course')
  @ApiOperation({ summary: 'Hide from students again' })
  unpublish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.courses.setPublished(id, false, actor);
  }

  @Post(':id/clone')
  @HttpCode(201)
  @RequireFeature('courses.create')
  @Audit('courses.clone', 'Course')
  @ApiOperation({
    summary:
      'Copy the course with its modules, lessons and prerequisites as a new draft',
  })
  clone(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.courses.clone(id, actor);
  }

  @Put(':id/prerequisites')
  @RequireFeature('courses.edit')
  @Audit('courses.prerequisites_set', 'Course')
  @ApiOperation({ summary: 'Replace the prerequisite course list' })
  async setPrerequisites(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPrerequisitesDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return {
      data: await this.courses.setPrerequisites(id, dto.courseIds, actor),
    };
  }

  @Get(':id/modules')
  @RequireFeature('courses.view')
  @ApiOperation({ summary: 'Modules with lessons, in order' })
  async modules(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.courses.modules(id, actor) };
  }

  @Post(':id/modules')
  @HttpCode(201)
  @RequireFeature('courses.modules.manage')
  @Audit('modules.create', 'Module')
  @ApiOperation({ summary: 'Add a module at the end' })
  createModule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateModuleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.courses.createModule(id, dto, actor);
  }

  @Put(':id/modules/order')
  @RequireFeature('courses.modules.manage')
  @Audit('modules.reorder', 'Course')
  @ApiOperation({ summary: 'Reorder modules' })
  async reorderModules(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.courses.reorderModules(id, dto.ids, actor) };
  }
}

@ApiTags('Curriculum')
@ApiBearerAuth('bearer')
@Controller('modules')
export class ModulesController {
  constructor(private readonly courses: CoursesService) {}

  @Patch(':id')
  @RequireFeature('courses.modules.manage')
  @Audit('modules.update', 'Module')
  @ApiOperation({ summary: 'Update a module' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateModuleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.courses.updateModule(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireFeature('courses.modules.manage')
  @Audit('modules.delete', 'Module')
  @ApiOperation({ summary: 'Delete a module and its lessons' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.courses.removeModule(id, actor);
  }

  @Post(':id/lessons')
  @HttpCode(201)
  @RequireFeature('courses.modules.manage')
  @Audit('lessons.create', 'Lesson')
  @ApiOperation({ summary: 'Add a lesson at the end of the module' })
  createLesson(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateLessonDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.courses.createLesson(id, dto, actor);
  }

  @Put(':id/lessons/order')
  @RequireFeature('courses.modules.manage')
  @Audit('lessons.reorder', 'Module')
  @ApiOperation({ summary: 'Reorder lessons inside a module' })
  async reorderLessons(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.courses.reorderLessons(id, dto.ids, actor) };
  }
}

@ApiTags('Curriculum')
@ApiBearerAuth('bearer')
@Controller('lessons')
export class LessonsController {
  constructor(private readonly courses: CoursesService) {}

  @Patch(':id')
  @RequireFeature('courses.modules.manage')
  @Audit('lessons.update', 'Lesson')
  @ApiOperation({ summary: 'Update a lesson' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLessonDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.courses.updateLesson(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireFeature('courses.modules.manage')
  @Audit('lessons.delete', 'Lesson')
  @ApiOperation({ summary: 'Delete a lesson' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.courses.removeLesson(id, actor);
  }
}
