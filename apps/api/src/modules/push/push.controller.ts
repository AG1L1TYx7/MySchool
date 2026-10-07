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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireFeature } from '../access/decorators/access.decorators';
import { Audit } from '../audit/audit.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RegisterDeviceDto } from './dto/push.dto';
import { PushService } from './push.service';

@ApiTags('Push')
@ApiBearerAuth('bearer')
@Controller()
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('me/devices')
  @RequireFeature('notifications.view')
  async devices(@CurrentUser() actor: AuthenticatedUser) {
    return {
      data: await this.push.devices(actor),
      configured: this.push.enabled,
    };
  }

  @Post('me/devices')
  @HttpCode(201)
  @RequireFeature('notifications.view')
  @ApiOperation({
    summary:
      'Register (or refresh) a device token for push; the same token re-registered just checks in',
  })
  register(
    @Body() dto: RegisterDeviceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.push.register(dto, actor);
  }

  @Delete('me/devices/:id')
  @HttpCode(204)
  @RequireFeature('notifications.view')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.push.remove(id, actor);
  }

  @Post('me/devices/test')
  @HttpCode(200)
  @RequireFeature('notifications.view')
  @ApiOperation({
    summary:
      'Send a test push to your own devices; simulated when no Firebase key is configured',
  })
  test(@CurrentUser() actor: AuthenticatedUser) {
    return this.push.test(actor);
  }

  @Get('organizations/:organizationId/push/status')
  @RequireFeature('organizations.view')
  @Audit('push.status.view', 'Organization')
  status(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.push.status(organizationId, actor);
  }
}
