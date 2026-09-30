import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit } from '../audit/audit.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AccessService } from './access.service';
import { RequireFeature } from './decorators/access.decorators';
import {
  SetFeatureFlagDto,
  SetRoleFeaturesDto,
  SetUserOverrideDto,
} from './dto/access.dto';
import { roleFromApi } from './roles';

/** Roles, the feature catalogue, role assignments, per-user overrides and feature flags (docs/09 section 3). */
@ApiTags('Access')
@ApiBearerAuth('bearer')
@Controller()
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get('roles')
  @ApiOperation({ summary: 'Role names and hierarchy levels' })
  roles() {
    return { data: this.access.roles() };
  }

  @Get('features')
  @ApiOperation({ summary: 'The feature catalogue grouped by category' })
  features() {
    return this.access.catalog().then((data) => ({ data }));
  }

  @Get('roles/:role/features')
  @RequireFeature('roles.manage')
  @ApiOperation({ summary: 'Feature codes assigned to a role' })
  async roleFeatures(@Param('role') roleName: string) {
    return { data: await this.access.roleFeatures(parseRole(roleName)) };
  }

  @Put('roles/:role/features')
  @RequireFeature('roles.manage')
  @Audit('access.role_features.replace', 'Role')
  @ApiOperation({ summary: 'Replace the feature set of a role' })
  async setRoleFeatures(
    @Param('role') roleName: string,
    @Body() dto: SetRoleFeaturesDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return {
      data: await this.access.setRoleFeatures(
        parseRole(roleName),
        dto.codes,
        actor.id,
      ),
    };
  }

  @Get('users/:userId/feature-overrides')
  @RequireFeature('users.view')
  @ApiOperation({ summary: 'Per-user grants and revocations' })
  async overrides(@Param('userId') userId: string) {
    return { data: await this.access.userOverrides(userId) };
  }

  @Put('users/:userId/feature-overrides/:code')
  @RequireFeature('roles.manage')
  @Audit('access.user_override.set', 'User')
  @ApiOperation({ summary: 'Grant or revoke a feature for one user' })
  async setOverride(
    @Param('userId') userId: string,
    @Param('code') code: string,
    @Body() dto: SetUserOverrideDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return {
      data: await this.access.setUserOverride(userId, code, dto, actor.id),
    };
  }

  @Delete('users/:userId/feature-overrides/:code')
  @HttpCode(204)
  @RequireFeature('roles.manage')
  @Audit('access.user_override.remove', 'User')
  @ApiOperation({ summary: 'Remove a per-user override' })
  async removeOverride(
    @Param('userId') userId: string,
    @Param('code') code: string,
  ): Promise<void> {
    await this.access.removeUserOverride(userId, code);
  }

  @Get('feature-flags')
  @RequireFeature('feature-flags.manage')
  @ApiOperation({ summary: 'Global feature flags' })
  async flags() {
    return { data: await this.access.featureFlags() };
  }

  @Patch('feature-flags/:name')
  @RequireFeature('feature-flags.manage')
  @Audit('access.feature_flag.set', 'FeatureFlag')
  @ApiOperation({ summary: 'Enable or disable a feature flag' })
  setFlag(@Param('name') name: string, @Body() dto: SetFeatureFlagDto) {
    return this.access.setFeatureFlag(name, dto.isEnabled);
  }
}

function parseRole(name: string) {
  const role = roleFromApi(name);
  if (!role)
    throw new BadRequestException({
      code: 'request.invalid',
      detail: `Unknown role '${name}'.`,
    });
  return role;
}
