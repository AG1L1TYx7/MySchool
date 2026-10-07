import {
  Body,
  Controller,
  Get,
  Headers,
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
import { Public } from '../auth/decorators/public.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  CreateTenantDto,
  UpdatePoliciesDto,
  UpdateTenantDto,
} from './dto/tenants.dto';
import { TenantsService } from './tenants.service';

@ApiTags('Tenants')
@Controller()
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get('branding')
  @Public()
  @ApiOperation({
    summary:
      'Name, colour and logo for the sign-in page of this host (or ?tenant=slug); public',
  })
  branding(
    @Headers('host') host: string | undefined,
    @Query('tenant') slug: string | undefined,
  ) {
    return this.tenants.brandingFor(host, slug || undefined);
  }

  @ApiBearerAuth('bearer')
  @Get('tenants')
  @RequireFeature('tenants.manage')
  async list(@CurrentUser() actor: AuthenticatedUser) {
    return { data: await this.tenants.list(actor) };
  }

  @ApiBearerAuth('bearer')
  @Post('tenants')
  @HttpCode(201)
  @RequireFeature('tenants.manage')
  @Audit('tenants.create', 'Tenant')
  create(
    @Body() dto: CreateTenantDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.tenants.create(dto, actor);
  }

  @ApiBearerAuth('bearer')
  @Get('tenants/:id')
  @RequireFeature('district.view')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.tenants.get(id, actor);
  }

  @ApiBearerAuth('bearer')
  @Patch('tenants/:id')
  @RequireFeature('district.manage')
  @Audit('tenants.update', 'Tenant')
  @ApiOperation({
    summary:
      'Platform administrators change anything; a superintendent renames and brands their own district',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.tenants.update(id, dto, actor);
  }

  @ApiBearerAuth('bearer')
  @Post('tenants/:id/domain/verify')
  @HttpCode(200)
  @RequireFeature('tenants.manage')
  @ApiOperation({
    summary:
      'Look up the DNS TXT record for the custom domain and mark it verified when present',
  })
  verify(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.tenants.verifyDomain(id, actor);
  }

  @ApiBearerAuth('bearer')
  @Get('tenants/:id/policies')
  @RequireFeature('district.view')
  policies(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.tenants.policies(id, actor);
  }

  @ApiBearerAuth('bearer')
  @Put('tenants/:id/policies')
  @RequireFeature('district.manage')
  @Audit('tenants.policies.update', 'Tenant')
  @ApiOperation({
    summary:
      'District switches: AI on or off (and per school), student messaging, disabled features, retention defaults',
  })
  setPolicies(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePoliciesDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.tenants.setPolicies(id, dto, actor);
  }
}
