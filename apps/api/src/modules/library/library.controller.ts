import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
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
import {
  AddCollectionItemDto,
  CreateCollectionDto,
  CreateLibraryItemDto,
  FlagItemDto,
  ListLibraryQuery,
  RateItemDto,
  ResolveFlagDto,
  ReviewItemDto,
  SearchLibraryQuery,
  UpdateCollectionDto,
  UpdateLibraryItemDto,
} from './dto/library.dto';
import { FLAG_REASONS, LIBRARY_KINDS, VISIBILITIES } from './library-rules';
import { LibraryService } from './library.service';

@ApiTags('Library')
@ApiBearerAuth('bearer')
@Controller('library')
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  @Get('meta')
  @RequireFeature('library.view')
  @ApiOperation({ summary: 'Kinds, visibilities and flag reasons' })
  meta() {
    return {
      kinds: LIBRARY_KINDS,
      visibilities: VISIBILITIES,
      flagReasons: FLAG_REASONS,
    };
  }

  @Get('items')
  @RequireFeature('library.view')
  @ApiOperation({
    summary:
      'Browse items you may see (filters: q, kind, subject, gradeLevel, featured, collectionId; mine=true for your own)',
  })
  list(@Query() q: ListLibraryQuery, @CurrentUser() actor: AuthenticatedUser) {
    return this.library.list(q, actor);
  }

  @Get('items/search')
  @RequireFeature('library.view')
  @ApiOperation({
    summary:
      'Search by meaning through the AI service, merged with keyword matches',
  })
  search(
    @Query() q: SearchLibraryQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.library.search(q, actor);
  }

  @Post('items')
  @RequireFeature('library.create')
  @ApiOperation({
    summary:
      'Add an item (interactive content, document, link or lesson plan) as a private draft',
  })
  create(
    @Body() dto: CreateLibraryItemDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.library.create(dto, actor);
  }

  @Get('items/:id')
  @RequireFeature('library.view')
  @ApiOperation({
    summary:
      'One item with its versions, your rating and the collections it is in',
  })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.library.get(id, actor);
  }

  @Patch('items/:id')
  @RequireFeature('library.create')
  @ApiOperation({
    summary:
      'Change an item; content changes become a new version; widening reach may need review',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLibraryItemDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.library.update(id, dto, actor);
  }

  @Delete('items/:id')
  @HttpCode(204)
  @RequireFeature('library.create')
  @ApiOperation({ summary: 'Remove an item from the library (soft delete)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.library.remove(id, actor);
  }

  @Post('items/:id/publish')
  @RequireFeature('library.create')
  @ApiOperation({
    summary: 'Publish, or submit for review when the reach needs an approver',
  })
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.library.publish(id, actor);
  }

  @Post('items/:id/unpublish')
  @RequireFeature('library.create')
  @ApiOperation({ summary: 'Back to draft' })
  unpublish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.library.unpublish(id, actor);
  }

  @Post('items/:id/archive')
  @RequireFeature('library.create')
  @ApiOperation({ summary: 'Archive (kept for the record, no longer listed)' })
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.library.unpublish(id, actor, true);
  }

  @Post('items/:id/review')
  @RequireFeature('library.moderate')
  @ApiOperation({ summary: 'Approve or reject an item waiting for review' })
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewItemDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.library.review(id, dto, actor);
  }

  @Post('items/:id/flag')
  @RequireFeature('library.view')
  @ApiOperation({ summary: 'Report an item to its moderators' })
  flag(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FlagItemDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.library.flag(id, dto, actor);
  }

  @Post('items/:id/rate')
  @RequireFeature('library.view')
  @ApiOperation({
    summary:
      'Rate an item one to five stars (one rating per person, replaced on repeat)',
  })
  rate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RateItemDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.library.rate(id, dto, actor);
  }

  @Post('items/:id/copy')
  @RequireFeature('library.create')
  @ApiOperation({
    summary: 'Copy an item into your own school as a private draft (remix)',
  })
  copy(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.library.copy(id, actor);
  }

  @Get('items/:id/versions')
  @RequireFeature('library.view')
  @ApiOperation({ summary: 'Version history with snapshots' })
  versions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.library.versions(id, actor);
  }

  @Post('items/:id/versions/:version/restore')
  @RequireFeature('library.create')
  @ApiOperation({ summary: 'Bring an earlier version back as a new version' })
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', ParseIntPipe) version: number,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.library.restore(id, version, actor);
  }

  @Get('items/:id/download')
  @RequireFeature('library.view')
  @ApiOperation({ summary: 'Download the document behind an item' })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const f = await this.library.download(id, actor);
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${f.fileName.replace(/"/g, '')}"`,
    );
    res.sendFile(f.absolutePath);
  }

  // Collections ----------------------------------------------------------------

  @Get('collections')
  @RequireFeature('library.view')
  @ApiOperation({ summary: 'Collections you may see' })
  collections(@CurrentUser() actor: AuthenticatedUser) {
    return this.library.listCollections(actor);
  }

  @Post('collections')
  @RequireFeature('library.create')
  @ApiOperation({ summary: 'Create a collection' })
  createCollection(
    @Body() dto: CreateCollectionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.library.createCollection(dto, actor);
  }

  @Get('collections/:id')
  @RequireFeature('library.view')
  @ApiOperation({ summary: 'A collection with its items' })
  collection(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.library.getCollection(id, actor);
  }

  @Patch('collections/:id')
  @RequireFeature('library.create')
  @ApiOperation({ summary: 'Change a collection' })
  updateCollection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCollectionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.library.updateCollection(id, dto, actor);
  }

  @Delete('collections/:id')
  @HttpCode(204)
  @RequireFeature('library.create')
  @ApiOperation({ summary: 'Remove a collection' })
  removeCollection(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.library.removeCollection(id, actor);
  }

  @Post('collections/:id/items')
  @RequireFeature('library.create')
  @ApiOperation({ summary: 'Add an item to a collection' })
  addItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddCollectionItemDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.library.addToCollection(id, dto, actor);
  }

  @Delete('collections/:id/items/:itemId')
  @RequireFeature('library.create')
  @ApiOperation({ summary: 'Take an item out of a collection' })
  removeItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.library.removeFromCollection(id, itemId, actor);
  }

  @Post('collections/:id/follow')
  @RequireFeature('library.view')
  @ApiOperation({ summary: 'Follow a collection' })
  follow(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.library.follow(id, actor, true);
  }

  @Delete('collections/:id/follow')
  @RequireFeature('library.view')
  @ApiOperation({ summary: 'Stop following a collection' })
  unfollow(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.library.follow(id, actor, false);
  }

  // Moderation -----------------------------------------------------------------

  @Get('moderation')
  @RequireFeature('library.moderate')
  @ApiOperation({ summary: 'Items waiting for your review and open reports' })
  moderation(@CurrentUser() actor: AuthenticatedUser) {
    return this.library.moderationQueue(actor);
  }

  @Post('flags/:id/resolve')
  @RequireFeature('library.moderate')
  @ApiOperation({ summary: 'Close a report: dismiss it or take the item down' })
  resolveFlag(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveFlagDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.library.resolveFlag(id, dto, actor);
  }
}
