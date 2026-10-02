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
  AddParticipantsDto,
  CreateConversationDto,
  EditMessageDto,
  ListMessagesQuery,
  SendMessageDto,
  UpdateConversationDto,
} from './dto/messaging.dto';
import { MessagingService } from './messaging.service';

@ApiTags('Messaging')
@ApiBearerAuth('bearer')
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly messaging: MessagingService) {}

  @Get()
  @RequireFeature('messages.view')
  @ApiOperation({
    summary: 'My conversations with unread counts, newest activity first',
  })
  async list(@CurrentUser() actor: AuthenticatedUser) {
    return { data: await this.messaging.list(actor) };
  }

  @Get('contacts')
  @RequireFeature('messages.send')
  @ApiOperation({
    summary: 'People I may message (students and parents: school staff only)',
  })
  async contacts(
    @Query('search') search: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return {
      data: await this.messaging.contacts(actor, search?.trim() || undefined),
    };
  }

  @Post()
  @HttpCode(201)
  @RequireFeature('messages.send')
  @Audit('conversations.create', 'Conversation')
  @ApiOperation({
    summary:
      'Start a direct, group (staff) or class (teacher) conversation; an existing direct one is returned',
  })
  create(
    @Body() dto: CreateConversationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.messaging.create(dto, actor);
  }

  @Get(':id')
  @RequireFeature('messages.view')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.messaging.get(id, actor);
  }

  @Patch(':id')
  @RequireFeature('messages.view')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConversationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.messaging.update(id, dto, actor);
  }

  @Post(':id/participants')
  @HttpCode(200)
  @RequireFeature('messages.send')
  addParticipants(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddParticipantsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.messaging.addParticipants(id, dto, actor);
  }

  @Delete(':id/participants/:userId')
  @HttpCode(204)
  @RequireFeature('messages.send')
  async removeParticipant(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.messaging.removeParticipant(id, userId, actor);
  }

  @Post(':id/leave')
  @HttpCode(204)
  @RequireFeature('messages.view')
  async leave(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.messaging.removeParticipant(id, actor.id, actor);
  }

  @Get(':id/messages')
  @RequireFeature('messages.view')
  @ApiOperation({
    summary: 'Messages, oldest first; before=<messageId> pages backwards',
  })
  async messages(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: ListMessagesQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.messaging.messages(id, q, actor) };
  }

  @Post(':id/messages')
  @HttpCode(201)
  @RequireFeature('messages.send')
  send(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.messaging.send(id, dto, actor);
  }

  @Post(':id/read')
  @HttpCode(200)
  @RequireFeature('messages.view')
  read(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.messaging.markRead(id, actor);
  }
}

@ApiTags('Messaging')
@ApiBearerAuth('bearer')
@Controller('messages')
export class MessagesController {
  constructor(private readonly messaging: MessagingService) {}

  @Patch(':id')
  @RequireFeature('messages.send')
  edit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditMessageDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.messaging.edit(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireFeature('messages.view')
  @Audit('messages.delete', 'Message')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.messaging.remove(id, actor);
  }
}
