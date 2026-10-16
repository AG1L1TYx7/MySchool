import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RequireFeature } from '../access/decorators/access.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { DeepLinkRespondDto, LinkContextDto } from './dto/lti-services.dto';
import { LAUNCH_PAGE_CSP } from './integration-rules';
import { LtiServicesService } from './lti-services.service';

/**
 * LTI 1.3 services, SmartSchool as the tool (slice 30): the platform's courses and their class link, the
 * roster sync (Names and Roles), the grade push (Assignment and Grade Services) and the deep-linking picker.
 */
@ApiTags('LTI')
@Controller()
export class LtiServicesController {
  constructor(private readonly services: LtiServicesService) {}

  @Get('organizations/:organizationId/lti/platforms/:platformId/contexts')
  @ApiBearerAuth('bearer')
  @RequireFeature('integrations.manage')
  @ApiOperation({
    summary:
      'Courses this platform has launched SmartSchool from, with their class link, services and line items',
  })
  contexts(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('platformId', ParseUUIDPipe) platformId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.services.listContexts(organizationId, platformId, actor);
  }

  @Patch('organizations/:organizationId/lti/platforms/:platformId/contexts/:id')
  @ApiBearerAuth('bearer')
  @RequireFeature('integrations.manage')
  @ApiOperation({ summary: 'Link a platform course to a class (null unlinks)' })
  link(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('platformId', ParseUUIDPipe) platformId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkContextDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.services.linkContext(
      organizationId,
      platformId,
      id,
      dto.classId ?? null,
      actor,
    );
  }

  @Post(
    'organizations/:organizationId/lti/platforms/:platformId/contexts/:id/sync',
  )
  @ApiBearerAuth('bearer')
  @RequireFeature('integrations.manage')
  @ApiOperation({
    summary:
      "Fill the linked class from the platform's roster (Names and Roles Provisioning Service)",
  })
  sync(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('platformId', ParseUUIDPipe) platformId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.services.syncRoster(organizationId, platformId, id, actor);
  }

  @Post(
    'organizations/:organizationId/lti/platforms/:platformId/contexts/:id/push-scores',
  )
  @ApiBearerAuth('bearer')
  @RequireFeature('integrations.manage')
  @ApiOperation({
    summary:
      "Send every grade of the course's linked assignments to the platform again (Assignment and Grade Services)",
  })
  pushScores(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('platformId', ParseUUIDPipe) platformId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.services.pushAll(organizationId, platformId, id, actor);
  }

  @Get('lti/deep-link/:ticket')
  @ApiBearerAuth('bearer')
  @RequireFeature('assignments.view')
  @ApiOperation({
    summary:
      'What a deep-linking picker shows: the platform, the course and the classes with their assignments',
  })
  deepLink(
    @Param('ticket') ticket: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.services.deepLinkContext(ticket, actor);
  }

  @Post('lti/deep-link/:ticket/respond')
  @Public()
  @ApiOperation({
    summary:
      'The picker form posts here; answers with a page that posts the signed deep-linking response to the platform',
  })
  async respond(
    @Param('ticket') ticket: string,
    @Body() dto: DeepLinkRespondDto,
    @Res() res: Response,
  ) {
    const html = await this.services.respondDeepLink(
      ticket,
      dto.assignmentIds ?? [],
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', LAUNCH_PAGE_CSP);
    res.send(html);
  }
}
