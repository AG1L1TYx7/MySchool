import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AppConfigService } from '../../config/app-config.service';
import { Public } from '../auth/decorators/public.decorator';
import {
  LTI_SCOPE,
  type LineItemInput,
  type ScoreInput,
} from './integration-rules';
import { LtiPlatformService } from './lti-platform.service';
import { LtiError } from './lti.service';

/**
 * LTI 1.3 services with SmartSchool as the platform (slice 30). Every service route is public to the
 * sign-in guard and instead requires the OAuth 2 service token from `POST /lti/token`, which names the
 * tool and its scopes.
 */
@ApiTags('LTI')
@Controller('lti')
export class LtiPlatformController {
  constructor(
    private readonly platform: LtiPlatformService,
    private readonly config: AppConfigService,
  ) {}

  @Post('token')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'OAuth 2 token endpoint for tools: client_credentials with a client assertion signed by the tool key',
  })
  token(@Body() body: Record<string, string | undefined>) {
    return this.platform.issueToken(body);
  }

  @Get('nrps/classes/:classId/memberships')
  @Public()
  @ApiOperation({
    summary:
      'Names and Roles: the members of a class, for a tool with the membership scope',
  })
  async memberships(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Headers('authorization') authorization: string | undefined,
    @Res() res: Response,
  ) {
    const tool = await this.platform.authorize(
      authorization,
      LTI_SCOPE.memberships,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.ims.lti-nrps.v2.membershipcontainer+json',
    );
    res.send(JSON.stringify(await this.platform.memberships(tool, classId)));
  }

  @Get('ags/classes/:classId/lineitems')
  @Public()
  @ApiOperation({
    summary: "Assignment and Grade Services: a tool's line items in a class",
  })
  async lineItems(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Headers('authorization') authorization: string | undefined,
    @Res() res: Response,
  ) {
    const tool = await this.platform.authorize(authorization, [
      LTI_SCOPE.lineItem,
      LTI_SCOPE.lineItemRead,
    ]);
    res.setHeader(
      'Content-Type',
      'application/vnd.ims.lis.v2.lineitemcontainer+json',
    );
    res.send(JSON.stringify(await this.platform.lineItems(tool, classId)));
  }

  @Post('ags/classes/:classId/lineitems')
  @Public()
  @ApiOperation({
    summary:
      'Assignment and Grade Services: create a line item (an assignment in the class)',
  })
  async createLineItem(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: LineItemInput,
    @Res() res: Response,
  ) {
    const tool = await this.platform.authorize(
      authorization,
      LTI_SCOPE.lineItem,
    );
    const item = await this.platform.createLineItem(tool, classId, body);
    res.status(201);
    res.setHeader('Content-Type', 'application/vnd.ims.lis.v2.lineitem+json');
    res.send(JSON.stringify(item));
  }

  @Get('ags/lineitems/:id')
  @Public()
  @ApiOperation({ summary: 'Assignment and Grade Services: one line item' })
  async lineItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') authorization: string | undefined,
    @Res() res: Response,
  ) {
    const tool = await this.platform.authorize(authorization, [
      LTI_SCOPE.lineItem,
      LTI_SCOPE.lineItemRead,
    ]);
    res.setHeader('Content-Type', 'application/vnd.ims.lis.v2.lineitem+json');
    res.send(JSON.stringify(await this.platform.getLineItem(tool, id)));
  }

  @Put('ags/lineitems/:id')
  @Public()
  @ApiOperation({
    summary: 'Assignment and Grade Services: update a line item',
  })
  async updateLineItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: LineItemInput,
    @Res() res: Response,
  ) {
    const tool = await this.platform.authorize(
      authorization,
      LTI_SCOPE.lineItem,
    );
    res.setHeader('Content-Type', 'application/vnd.ims.lis.v2.lineitem+json');
    res.send(
      JSON.stringify(await this.platform.updateLineItem(tool, id, body)),
    );
  }

  @Delete('ags/lineitems/:id')
  @Public()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Assignment and Grade Services: delete a line item',
  })
  async deleteLineItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tool = await this.platform.authorize(
      authorization,
      LTI_SCOPE.lineItem,
    );
    await this.platform.deleteLineItem(tool, id);
  }

  @Post('ags/lineitems/:id/scores')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Assignment and Grade Services: post a score; a fully graded score becomes a grade in the gradebook',
  })
  async score(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: ScoreInput,
  ) {
    const tool = await this.platform.authorize(authorization, LTI_SCOPE.score);
    return this.platform.postScore(tool, id, body);
  }

  @Get('ags/lineitems/:id/results')
  @Public()
  @ApiOperation({
    summary: 'Assignment and Grade Services: the results of a line item',
  })
  async results(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') authorization: string | undefined,
    @Query('user_id') userId: string | undefined,
    @Res() res: Response,
  ) {
    const tool = await this.platform.authorize(authorization, LTI_SCOPE.result);
    res.setHeader(
      'Content-Type',
      'application/vnd.ims.lis.v2.resultcontainer+json',
    );
    res.send(
      JSON.stringify(
        await this.platform.results(tool, id, userId || undefined),
      ),
    );
  }

  @Post('platform/deep-link-return')
  @Public()
  @ApiOperation({
    summary:
      'Deep Linking return: the tool posts its signed content items; they become links in the class',
  })
  async deepLinkReturn(
    @Body() body: Record<string, string | undefined>,
    @Res() res: Response,
  ) {
    const web = this.config.get('WEB_APP_URL').replace(/\/$/, '');
    try {
      const { classId, created } = await this.platform.deepLinkReturn(body.JWT);
      res.redirect(`${web}/classes/${classId}?tools=${created}`);
    } catch (err) {
      res.redirect(
        `${web}/login?error=lti_${err instanceof LtiError ? err.code : 'failed'}`,
      );
    }
  }
}
