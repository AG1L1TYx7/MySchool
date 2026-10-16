import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireFeature } from '../access/decorators/access.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { LtiPlatformService } from './lti-platform.service';

/** Content tools placed in a class through Deep Linking (slice 30). */
@ApiTags('LTI')
@ApiBearerAuth('bearer')
@Controller('classes/:classId/lti-links')
export class LtiLinksController {
  constructor(private readonly platform: LtiPlatformService) {}

  @Get()
  @RequireFeature('lti.launch')
  @ApiOperation({
    summary: 'Tool content placed in this class, openable by its people',
  })
  list(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.platform.linksForClass(classId, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireFeature('lti.launch')
  @ApiOperation({
    summary: 'Remove a piece of tool content from the class (its teachers)',
  })
  remove(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.platform.removeLink(classId, id, actor);
  }
}
