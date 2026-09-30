import {
  Body,
  Controller,
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
import { CreateUserDto, ListUsersQuery, UpdateUserDto } from './dto/users.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth('bearer')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequireFeature('users.view')
  @ApiOperation({ summary: 'List users in scope (paginated, searchable)' })
  list(@Query() q: ListUsersQuery, @CurrentUser() actor: AuthenticatedUser) {
    return this.users.list(q, actor);
  }

  @Get(':id')
  @RequireFeature('users.view')
  @ApiOperation({ summary: 'Get one user' })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.get(id, actor);
  }

  @Post()
  @HttpCode(201)
  @RequireFeature('users.create')
  @Audit('users.create', 'User')
  @ApiOperation({
    summary: 'Create a user; without a password an invitation code is emailed',
  })
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.users.create(dto, actor);
  }

  @Patch(':id')
  @RequireFeature('users.edit')
  @Audit('users.update', 'User')
  @ApiOperation({ summary: 'Update name, role, status or organisation' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.update(id, dto, actor);
  }

  @Post(':id/reset-password')
  @HttpCode(202)
  @RequireFeature('users.password.reset')
  @Audit('users.password_reset_triggered', 'User')
  @ApiOperation({ summary: 'Email a password reset code to the user' })
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.triggerPasswordReset(id, actor);
  }
}
