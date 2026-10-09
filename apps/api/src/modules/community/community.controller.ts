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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireFeature } from '../access/decorators/access.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  GROUP_KINDS,
  GROUP_VISIBILITIES,
  JOIN_POLICIES,
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  REACTION_KINDS,
  REPORT_REASONS,
  REPORT_RESOLUTIONS,
} from './community-rules';
import { CommunityService } from './community.service';
import {
  AddMemberDto,
  CreateGroupDto,
  CreatePostDto,
  CreateTopicDto,
  ListGroupsQuery,
  ListTopicsQuery,
  ModerateDto,
  ReactDto,
  ReportDto,
  ResolveReportDto,
  UpdateGroupDto,
  UpdateMemberDto,
  UpdatePostDto,
  UpdateTopicDto,
} from './dto/community.dto';

@ApiTags('Community')
@ApiBearerAuth('bearer')
@Controller('community')
export class CommunityController {
  constructor(private readonly community: CommunityService) {}

  @Get('meta')
  @RequireFeature('community.view')
  @ApiOperation({
    summary:
      'Kinds, visibilities, join policies, reactions, report reasons and limits',
  })
  meta() {
    return {
      kinds: GROUP_KINDS,
      visibilities: GROUP_VISIBILITIES,
      joinPolicies: JOIN_POLICIES,
      reactions: REACTION_KINDS,
      reportReasons: REPORT_REASONS,
      resolutions: REPORT_RESOLUTIONS,
      maxTitleLength: MAX_TITLE_LENGTH,
      maxBodyLength: MAX_BODY_LENGTH,
    };
  }

  @Get('feed')
  @RequireFeature('community.view')
  @ApiOperation({ summary: 'Recent topics across your groups' })
  feed(@CurrentUser() actor: AuthenticatedUser) {
    return this.community.feed(actor);
  }

  // Groups ----------------------------------------------------------------------

  @Get('groups')
  @RequireFeature('community.view')
  @ApiOperation({ summary: 'Groups you can see or join (q, kind, mine=true)' })
  listGroups(
    @Query() q: ListGroupsQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.listGroups(q, actor);
  }

  @Post('groups')
  @RequireFeature('community.manage')
  @ApiOperation({
    summary:
      'Create a club or school-wide group; you become its first moderator',
  })
  createGroup(
    @Body() dto: CreateGroupDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.createGroup(dto, actor);
  }

  @Get('classes/:classId')
  @RequireFeature('community.view')
  @ApiOperation({
    summary:
      'The class discussion group (created on first open; members follow the roster)',
  })
  classDiscussion(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.classDiscussion(classId, actor);
  }

  @Get('groups/:id')
  @RequireFeature('community.view')
  @ApiOperation({
    summary: 'One group with your membership and what you may do',
  })
  getGroup(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.getGroup(id, actor);
  }

  @Patch('groups/:id')
  @RequireFeature('community.view')
  @ApiOperation({ summary: 'Change a group (moderators)' })
  updateGroup(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGroupDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.updateGroup(id, dto, actor);
  }

  @Post('groups/:id/archive')
  @RequireFeature('community.view')
  @ApiOperation({
    summary:
      'Archive a group (moderators); members and moderators can still read it',
  })
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.archiveGroup(id, actor);
  }

  @Post('groups/:id/restore')
  @RequireFeature('community.view')
  @ApiOperation({ summary: 'Bring an archived group back' })
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.archiveGroup(id, actor, true);
  }

  @Post('groups/:id/join')
  @RequireFeature('community.post')
  @ApiOperation({
    summary: 'Join an open group, or ask to join one that needs approval',
  })
  join(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.join(id, actor);
  }

  @Delete('groups/:id/join')
  @HttpCode(204)
  @RequireFeature('community.view')
  @ApiOperation({ summary: 'Leave a group' })
  leave(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.leave(id, actor);
  }

  @Get('groups/:id/members')
  @RequireFeature('community.view')
  @ApiOperation({ summary: 'Members (and, for moderators, pending requests)' })
  members(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.listMembers(id, actor);
  }

  @Post('groups/:id/members')
  @RequireFeature('community.view')
  @ApiOperation({ summary: 'Add a member (moderators)' })
  addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMemberDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.addMember(id, dto, actor);
  }

  @Patch('groups/:id/members/:userId')
  @RequireFeature('community.view')
  @ApiOperation({
    summary: 'Approve, promote, demote or pause a member (moderators)',
  })
  updateMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateMemberDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.updateMember(id, userId, dto, actor);
  }

  @Delete('groups/:id/members/:userId')
  @HttpCode(204)
  @RequireFeature('community.view')
  @ApiOperation({ summary: 'Remove a member (moderators)' })
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.removeMember(id, userId, actor);
  }

  // Topics and replies ----------------------------------------------------------

  @Get('groups/:id/topics')
  @RequireFeature('community.view')
  @ApiOperation({
    summary:
      'Topics in a group, pinned first then by latest activity (q to search)',
  })
  topics(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: ListTopicsQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.listTopics(id, q, actor);
  }

  @Post('groups/:id/topics')
  @RequireFeature('community.post')
  @ApiOperation({
    summary:
      'Start a topic; a student topic the safety check holds waits for a teacher',
  })
  createTopic(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTopicDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.createTopic(id, dto, actor);
  }

  @Get('topics/:id')
  @RequireFeature('community.view')
  @ApiOperation({
    summary: 'A topic with its replies, reactions and your subscription',
  })
  topic(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.getTopic(id, actor);
  }

  @Patch('topics/:id')
  @RequireFeature('community.view')
  @ApiOperation({
    summary:
      'Edit a topic within the window (author) or any time; pin and lock (moderators)',
  })
  updateTopic(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTopicDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.updateTopic(id, dto, actor);
  }

  @Delete('topics/:id')
  @HttpCode(204)
  @RequireFeature('community.view')
  @ApiOperation({ summary: 'Remove a topic (author or moderator)' })
  deleteTopic(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.deleteTopic(id, actor);
  }

  @Post('topics/:id/posts')
  @RequireFeature('community.post')
  @ApiOperation({ summary: 'Reply to a topic' })
  reply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePostDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.createPost(id, dto, actor);
  }

  @Post('topics/:id/subscribe')
  @RequireFeature('community.view')
  @ApiOperation({ summary: 'Hear about new replies' })
  subscribe(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.subscribe(id, actor, true);
  }

  @Delete('topics/:id/subscribe')
  @RequireFeature('community.view')
  @ApiOperation({ summary: 'Stop hearing about new replies' })
  unsubscribe(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.subscribe(id, actor, false);
  }

  @Patch('posts/:id')
  @RequireFeature('community.view')
  @ApiOperation({
    summary: 'Edit a reply within the window (author) or any time (moderators)',
  })
  updatePost(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePostDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.updatePost(id, dto, actor);
  }

  @Delete('posts/:id')
  @HttpCode(204)
  @RequireFeature('community.view')
  @ApiOperation({ summary: 'Remove a reply (author or moderator)' })
  deletePost(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.deletePost(id, actor);
  }

  @Put('posts/:id/reaction')
  @RequireFeature('community.view')
  @ApiOperation({
    summary: 'React to a reply (one reaction per person, replaced on repeat)',
  })
  react(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReactDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.react(id, dto.kind, actor);
  }

  @Delete('posts/:id/reaction')
  @RequireFeature('community.view')
  @ApiOperation({ summary: 'Take a reaction back' })
  unreact(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.unreact(id, actor);
  }

  // Reports and moderation ------------------------------------------------------

  @Post('reports')
  @RequireFeature('community.view')
  @ApiOperation({ summary: 'Report a topic or reply to the moderators' })
  report(@Body() dto: ReportDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.community.report(dto, actor);
  }

  @Get('moderation')
  @RequireFeature('community.moderate')
  @ApiOperation({
    summary:
      'Held topics and replies plus open reports for the groups you moderate',
  })
  moderation(@CurrentUser() actor: AuthenticatedUser) {
    return this.community.moderationQueue(actor);
  }

  @Post('topics/:id/moderate')
  @RequireFeature('community.moderate')
  @ApiOperation({
    summary: 'Approve, hide, remove or restore a topic (audited)',
  })
  moderateTopic(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerateDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.moderate('topic', id, dto, actor);
  }

  @Post('posts/:id/moderate')
  @RequireFeature('community.moderate')
  @ApiOperation({
    summary: 'Approve, hide, remove or restore a reply (audited)',
  })
  moderatePost(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerateDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.moderate('post', id, dto, actor);
  }

  @Post('reports/:id/resolve')
  @RequireFeature('community.moderate')
  @ApiOperation({
    summary:
      'Close a report: dismiss, warn the author, hide or remove the content (audited)',
  })
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveReportDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.community.resolveReport(id, dto, actor);
  }
}
