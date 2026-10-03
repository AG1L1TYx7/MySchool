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
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  RequireAnyFeature,
  RequireFeature,
} from '../access/decorators/access.decorators';
import { Audit } from '../audit/audit.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  CommentDto,
  GenerateReportCardsDto,
  ListReportCardsQuery,
  PublishReportCardsDto,
} from './dto/report-cards.dto';
import { ReportCardsService } from './report-cards.service';

const VIEW = [
  'report-cards.view.all',
  'report-cards.view.own',
  'report-cards.view.child',
];

@ApiTags('Report cards')
@ApiBearerAuth('bearer')
@Controller('report-cards')
export class ReportCardsController {
  constructor(private readonly cards: ReportCardsService) {}

  @Post('generate')
  @HttpCode(200)
  @RequireFeature('report-cards.manage')
  @Audit('report-cards.generate', 'GradingPeriod')
  @ApiOperation({
    summary:
      'Create or refresh draft report cards for a grading period (teachers: one class; administrators: the school)',
  })
  generate(
    @Body() dto: GenerateReportCardsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.cards.generate(dto, actor);
  }

  @Post('publish')
  @HttpCode(200)
  @RequireFeature('report-cards.publish')
  @Audit('report-cards.publish', 'GradingPeriod')
  @ApiOperation({
    summary:
      'Publish every draft for a grading period; students and parents are told',
  })
  publishAll(
    @Body() dto: PublishReportCardsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.cards.publishAll(dto, actor);
  }

  @Get()
  @RequireAnyFeature(...VIEW)
  @ApiOperation({
    summary:
      'Report cards: staff see their classes or school; students and parents see published ones',
  })
  list(
    @Query() q: ListReportCardsQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.cards.list(q, actor);
  }

  @Get(':id')
  @RequireAnyFeature(...VIEW)
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.cards.get(id, actor);
  }

  @Get(':id/pdf')
  @RequireAnyFeature(...VIEW)
  @ApiProduces('application/pdf')
  async pdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const buffer = await this.cards.pdf(id, actor);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="report-card-${id}.pdf"`,
    );
    res.send(buffer);
  }

  @Patch(':id/lines/:lineId')
  @RequireFeature('report-cards.comment')
  @ApiOperation({
    summary: 'Teacher comment on one class line (while the card is a draft)',
  })
  comment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: CommentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.cards.comment(id, lineId, dto, actor);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequireFeature('report-cards.publish')
  @Audit('report-cards.publish', 'ReportCard')
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.cards.publish(id, actor);
  }
}
