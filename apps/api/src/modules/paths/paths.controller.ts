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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireFeature } from '../access/decorators/access.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  CreatePathDto,
  GeneratePathDto,
  StepInputDto,
  UpdatePathDto,
  UpdateStepDto,
} from './dto/paths.dto';
import { PathsService } from './paths.service';

@ApiTags('Learning paths')
@ApiBearerAuth('bearer')
@Controller()
export class PathsController {
  constructor(private readonly paths: PathsService) {}

  @Get('me/learning/profile')
  @RequireFeature('learning.view')
  @ApiOperation({
    summary:
      'My integrated learning profile: health score with its parts, gaps, next steps and active paths',
  })
  async myProfile(@CurrentUser() actor: AuthenticatedUser) {
    const student = await this.paths.ownStudent(actor);
    return this.paths.profile(student.id, actor);
  }

  @Get('me/learning/paths')
  @RequireFeature('learning.view')
  @ApiOperation({ summary: 'My learning paths' })
  async myPaths(@CurrentUser() actor: AuthenticatedUser) {
    const student = await this.paths.ownStudent(actor);
    return this.paths.listPaths(student.id, actor);
  }

  @Get('students/:id/learning/profile')
  @RequireFeature('learning.view')
  @ApiOperation({
    summary:
      "A student's integrated learning profile (family, their teachers and school staff)",
  })
  profile(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paths.profile(id, actor);
  }

  @Get('students/:id/learning/paths')
  @RequireFeature('learning.view')
  @ApiOperation({ summary: "A student's learning paths" })
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paths.listPaths(id, actor);
  }

  @Post('students/:id/learning/paths/generate')
  @RequireFeature('learning.records')
  @ApiOperation({
    summary:
      'Build a path from the weakest standards and the content that teaches them (optional { subject })',
  })
  generate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GeneratePathDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paths.generate(id, dto, actor);
  }

  @Post('students/:id/learning/paths')
  @RequireFeature('learning.records')
  @ApiOperation({ summary: 'Create a path by hand with its steps' })
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePathDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paths.create(id, dto, actor);
  }

  @Get('learning/paths/:id')
  @RequireFeature('learning.view')
  @ApiOperation({ summary: 'One path with its steps and progress' })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paths.getPath(id, actor);
  }

  @Patch('learning/paths/:id')
  @RequireFeature('learning.records')
  @ApiOperation({
    summary: 'Rename, set the goal or change the status of a path',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePathDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paths.update(id, dto, actor);
  }

  @Delete('learning/paths/:id')
  @HttpCode(204)
  @RequireFeature('learning.records')
  @ApiOperation({ summary: 'Delete a path' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paths.remove(id, actor);
  }

  @Post('learning/paths/:id/steps')
  @RequireFeature('learning.records')
  @ApiOperation({ summary: 'Add a step at the end' })
  addStep(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StepInputDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paths.addStep(id, dto, actor);
  }

  @Patch('learning/paths/:id/steps/:stepId')
  @RequireFeature('learning.view')
  @ApiOperation({
    summary:
      'Students: mark a step done or skipped. Staff: also retitle, reorder (position) or reset it',
  })
  updateStep(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stepId', ParseUUIDPipe) stepId: string,
    @Body() dto: UpdateStepDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paths.updateStep(id, stepId, dto, actor);
  }

  @Delete('learning/paths/:id/steps/:stepId')
  @RequireFeature('learning.records')
  @ApiOperation({ summary: 'Remove a step' })
  removeStep(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stepId', ParseUUIDPipe) stepId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paths.removeStep(id, stepId, actor);
  }

  @Get('classes/:id/learning/paths')
  @RequireFeature('learning.records')
  @ApiOperation({
    summary: 'Every active and completed path of the students in a class',
  })
  classPaths(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.paths.classPaths(id, actor);
  }
}
