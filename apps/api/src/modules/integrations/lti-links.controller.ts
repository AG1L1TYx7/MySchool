import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { RequireFeature } from '../access/decorators/access.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { LtiPlatformService } from './lti-platform.service';

export class AssignLineItemDto {
  @ApiProperty({ description: 'The assignment the tool will grade' })
  @IsUUID()
  assignmentId!: string;

  @ApiProperty({ description: 'The tool that will post scores' })
  @IsUUID()
  toolId!: string;
}

/** Content tools placed in a class through Deep Linking (slice 30), and the line items tools grade (slice 34). */
@ApiTags('LTI')
@ApiBearerAuth('bearer')
@Controller('classes/:classId')
export class LtiLinksController {
  constructor(private readonly platform: LtiPlatformService) {}

  @Get('lti-links')
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

  @Delete('lti-links/:id')
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

  @Get('lti-line-items')
  @RequireFeature('lti.launch')
  @ApiOperation({
    summary:
      'Line items tools grade in this class, with their assignment and score count',
  })
  lineItems(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.platform.classLineItems(classId, actor);
  }

  @Post('lti-line-items')
  @RequireFeature('grades.edit')
  @ApiOperation({
    summary:
      'Let a tool grade an assignment made here: a line item the tool posts scores to',
  })
  assignLineItem(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() dto: AssignLineItemDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.platform.lineItemForAssignment(
      classId,
      dto.assignmentId,
      dto.toolId,
      actor,
    );
  }
}
