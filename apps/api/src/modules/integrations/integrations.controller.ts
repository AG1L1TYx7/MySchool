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
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RequireFeature } from '../access/decorators/access.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiKeysService } from './api-keys.service';
import {
  CreateApiKeyDto,
  CreateLtiPlatformDto,
  CreateLtiToolDto,
  CreateWebhookDto,
  ListDeliveriesQuery,
  UpdateLtiPlatformDto,
  UpdateLtiToolDto,
  UpdateWebhookDto,
} from './dto/integrations.dto';
import { LtiService } from './lti.service';
import { WebhooksService } from './webhooks.service';

/** Integrations an administrator manages for one school: webhooks, API keys, LTI platforms and tools. */
@ApiTags('Integrations')
@ApiBearerAuth('bearer')
@Controller('organizations/:organizationId')
export class IntegrationsController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly apiKeys: ApiKeysService,
    private readonly lti: LtiService,
  ) {}

  // Webhooks -----------------------------------------------------------------

  @Get('webhooks')
  @RequireFeature('integrations.manage')
  @ApiOperation({ summary: 'Webhook subscriptions of the school' })
  listWebhooks(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.webhooks.list(organizationId, actor);
  }

  @Get('webhooks/event-types')
  @RequireFeature('integrations.manage')
  @ApiOperation({ summary: 'Event types a subscription may ask for' })
  eventTypes() {
    return { eventTypes: this.webhooks.eventTypes() };
  }

  @Post('webhooks')
  @RequireFeature('integrations.manage')
  @ApiOperation({
    summary: 'Create a subscription; the secret is returned once',
  })
  createWebhook(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateWebhookDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.webhooks.create(organizationId, dto, actor);
  }

  @Patch('webhooks/:id')
  @RequireFeature('integrations.manage')
  @ApiOperation({
    summary: 'Update a subscription (name, url, events, active, retry limit)',
  })
  updateWebhook(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWebhookDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.webhooks.update(organizationId, id, dto, actor);
  }

  @Delete('webhooks/:id')
  @HttpCode(204)
  @RequireFeature('integrations.manage')
  @ApiOperation({ summary: 'Delete a subscription and its delivery history' })
  removeWebhook(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.webhooks.remove(organizationId, id, actor);
  }

  @Post('webhooks/:id/rotate-secret')
  @RequireFeature('integrations.manage')
  @ApiOperation({
    summary: 'Rotate the signing secret; the new one is returned once',
  })
  rotateSecret(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.webhooks.rotateSecret(organizationId, id, actor);
  }

  @Post('webhooks/:id/test')
  @RequireFeature('integrations.manage')
  @ApiOperation({
    summary: 'Send a webhook.test event now and report the outcome',
  })
  testWebhook(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.webhooks.test(organizationId, id, actor);
  }

  @Get('webhooks/:id/deliveries')
  @RequireFeature('integrations.manage')
  @ApiOperation({ summary: 'Delivery history of a subscription' })
  deliveries(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: ListDeliveriesQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.webhooks.deliveries(organizationId, id, q, actor);
  }

  // API keys -------------------------------------------------------------------

  @Get('api-keys')
  @RequireFeature('integrations.manage')
  @ApiOperation({ summary: 'API keys of the school (never the key itself)' })
  listKeys(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.apiKeys.list(organizationId, actor);
  }

  @Get('api-keys/scopes')
  @RequireFeature('integrations.manage')
  @ApiOperation({ summary: 'Scopes a key may be given' })
  scopes() {
    return { scopes: this.apiKeys.scopes() };
  }

  @Post('api-keys')
  @RequireFeature('integrations.manage')
  @ApiOperation({
    summary: 'Create a key; the key is returned once. Present it as X-Api-Key.',
  })
  createKey(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateApiKeyDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.apiKeys.create(organizationId, dto, actor);
  }

  @Delete('api-keys/:id')
  @RequireFeature('integrations.manage')
  @ApiOperation({ summary: 'Revoke a key (kept in the list for the record)' })
  revokeKey(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.apiKeys.revoke(organizationId, id, actor);
  }

  // LTI platforms (SmartSchool as a tool) -------------------------------------

  @Get('lti/platforms')
  @RequireFeature('integrations.manage')
  @ApiOperation({
    summary: 'Platforms (Canvas, Schoology) that may launch SmartSchool',
  })
  listPlatforms(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.lti.listPlatforms(organizationId, actor);
  }

  @Post('lti/platforms')
  @RequireFeature('integrations.manage')
  @ApiOperation({ summary: 'Register a platform' })
  createPlatform(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateLtiPlatformDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.lti.createPlatform(organizationId, dto, actor);
  }

  @Patch('lti/platforms/:id')
  @RequireFeature('integrations.manage')
  @ApiOperation({ summary: 'Update a platform' })
  updatePlatform(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLtiPlatformDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.lti.updatePlatform(organizationId, id, dto, actor);
  }

  @Delete('lti/platforms/:id')
  @HttpCode(204)
  @RequireFeature('integrations.manage')
  @ApiOperation({ summary: 'Remove a platform (its user links go with it)' })
  removePlatform(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.lti.removePlatform(organizationId, id, actor);
  }

  // LTI tools (SmartSchool as a platform) -------------------------------------

  @Get('lti/tools')
  @RequireFeature('integrations.manage')
  @ApiOperation({
    summary:
      'External tools SmartSchool launches, with the platform details to give each tool',
  })
  listTools(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.lti.listTools(organizationId, actor);
  }

  @Post('lti/tools')
  @RequireFeature('integrations.manage')
  @ApiOperation({
    summary:
      'Register a tool; SmartSchool assigns the client id and deployment id',
  })
  createTool(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateLtiToolDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.lti.createTool(organizationId, dto, actor);
  }

  @Patch('lti/tools/:id')
  @RequireFeature('integrations.manage')
  @ApiOperation({ summary: 'Update a tool' })
  updateTool(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLtiToolDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.lti.updateTool(organizationId, id, dto, actor);
  }

  @Delete('lti/tools/:id')
  @HttpCode(204)
  @RequireFeature('integrations.manage')
  @ApiOperation({ summary: 'Remove a tool' })
  removeTool(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.lti.removeTool(organizationId, id, actor);
  }

  @Get('lti/tools/:id/launch')
  @RequireFeature('lti.launch')
  @ApiOperation({
    summary:
      'Open a tool: an HTML page that starts the LTI launch (optional ?classId=)',
  })
  async launchTool(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('classId') classId: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const html = await this.lti.launchTool(
      organizationId,
      id,
      classId || undefined,
      actor,
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  }
}
