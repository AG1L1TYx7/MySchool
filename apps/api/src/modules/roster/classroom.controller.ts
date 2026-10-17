import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PROBE_LIMIT } from '../../common/throttle-limits';
import { RequireFeature } from '../access/decorators/access.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ClassroomService } from './classroom.service';

/** Google Classroom for one class (slice 30): whether it is a Classroom course, and the grade push. */
@ApiTags('Rostering')
@ApiBearerAuth('bearer')
@Controller('classes/:classId/classroom')
export class ClassroomController {
  constructor(private readonly classroom: ClassroomService) {}

  @Get()
  @RequireFeature('grades.view.all')
  @ApiOperation({
    summary:
      'Whether this class is a Google Classroom course and what was pushed',
  })
  status(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.classroom.status(classId, actor);
  }

  @Post('import')
  @Throttle(PROBE_LIMIT)
  @RequireFeature('grades.edit')
  @ApiOperation({
    summary:
      "Import the course's published Classroom work as assignments, with the grades Classroom already holds",
  })
  importWork(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.classroom.importCourseWork(classId, actor);
  }

  @Post('push-grades')
  @Throttle(PROBE_LIMIT)
  @RequireFeature('grades.edit')
  @ApiOperation({
    summary:
      "Write every grade of the class's published assignments to the Classroom course (course work is created as needed)",
  })
  push(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.classroom.pushGrades(classId, actor);
  }
}
