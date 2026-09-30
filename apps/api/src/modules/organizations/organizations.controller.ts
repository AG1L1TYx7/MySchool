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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireFeature } from '../access/decorators/access.decorators';
import { Audit } from '../audit/audit.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  AddMemberDto,
  CreateOrganizationDto,
  ListMembersQuery,
  ListOrganizationsQuery,
  UpdateOrganizationDto,
} from './dto/organizations.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('Organisations')
@ApiBearerAuth('bearer')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @RequireFeature('organizations.view')
  @ApiOperation({ summary: 'List organisations in scope' })
  list(
    @Query() q: ListOrganizationsQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.organizations.list(q, actor);
  }

  @Post()
  @HttpCode(201)
  @RequireFeature('organizations.manage')
  @Audit('organizations.create', 'Organization')
  @ApiOperation({ summary: 'Create an organisation' })
  create(
    @Body() dto: CreateOrganizationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.organizations.create(dto, actor);
  }

  @Get(':id')
  @RequireFeature('organizations.view')
  @ApiOperation({ summary: 'Organisation with member and student counts' })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.organizations.get(id, actor);
  }

  @Patch(':id')
  @RequireFeature('organizations.manage')
  @Audit('organizations.update', 'Organization')
  @ApiOperation({ summary: 'Update an organisation' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrganizationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.organizations.update(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireFeature('organizations.manage')
  @Audit('organizations.delete', 'Organization')
  @ApiOperation({ summary: 'Soft-delete an organisation' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.organizations.remove(id, actor);
  }

  @Get(':id/members')
  @RequireFeature('organizations.view')
  @ApiOperation({ summary: 'Members (users) of an organisation' })
  members(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: ListMembersQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.organizations.members(id, q, actor);
  }

  @Post(':id/members')
  @HttpCode(200)
  @RequireFeature('organizations.manage')
  @Audit('organizations.member_added', 'Organization')
  @ApiOperation({
    summary: 'Link an existing user to the organisation (by id or email)',
  })
  addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMemberDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.organizations.addMember(id, dto, actor);
  }
}
