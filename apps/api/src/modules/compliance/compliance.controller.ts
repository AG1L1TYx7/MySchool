import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  RequireAnyFeature,
  RequireFeature,
} from '../access/decorators/access.decorators';
import { Audit } from '../audit/audit.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ComplianceService } from './compliance.service';
import {
  CreateDeletionRequestDto,
  CreateIncidentDto,
  DecideDeletionDto,
  LegalHoldDto,
  RetentionDto,
  UpdateIncidentDto,
} from './dto/compliance.dto';

@ApiTags('Compliance')
@ApiBearerAuth('bearer')
@Controller()
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get('organizations/:organizationId/compliance/data-map')
  @RequireFeature('compliance.view')
  @ApiOperation({
    summary:
      'Every table that holds personal data, whose it is, why, how long, with live row counts',
  })
  dataMap(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.compliance.dataMap(organizationId, actor);
  }

  @Get('organizations/:organizationId/compliance/retention')
  @RequireFeature('compliance.view')
  retention(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.compliance.retention(organizationId, actor);
  }

  @Put('organizations/:organizationId/compliance/retention')
  @RequireFeature('compliance.manage')
  @Audit('compliance.retention.update', 'Organization')
  setRetention(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: RetentionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.compliance.setRetention(organizationId, dto, actor);
  }

  @Post('organizations/:organizationId/compliance/retention/run')
  @HttpCode(200)
  @RequireFeature('compliance.manage')
  @ApiOperation({
    summary: 'Apply the retention policy now and report what was removed',
  })
  runRetention(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.compliance.runRetention(organizationId, actor);
  }

  @Get('organizations/:organizationId/compliance/deletion-requests')
  @RequireFeature('compliance.view')
  async deletionRequests(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return {
      data: await this.compliance.deletionRequests(organizationId, actor),
      plan: this.compliance.deletionPlan(),
    };
  }

  @Post('students/:id/deletion-requests')
  @HttpCode(201)
  @RequireAnyFeature('compliance.manage', 'family.view')
  @ApiOperation({
    summary:
      "Ask for a student's records to be erased: a guardian, the student or an administrator",
  })
  requestDeletion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateDeletionRequestDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.compliance.requestDeletion(id, dto, actor);
  }

  @Get('students/:id/deletion-requests')
  @RequireAnyFeature('compliance.view', 'family.view')
  async myDeletionRequests(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return {
      data: await this.compliance.myDeletionRequests(id, actor),
      plan: this.compliance.deletionPlan(),
    };
  }

  @Post('deletion-requests/:id/decide')
  @HttpCode(200)
  @RequireFeature('compliance.manage')
  @Audit('compliance.deletion.decide', 'DeletionRequest')
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideDeletionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.compliance.decideDeletion(id, dto, actor);
  }

  @Post('deletion-requests/:id/execute')
  @HttpCode(200)
  @RequireFeature('compliance.manage')
  @ApiOperation({
    summary:
      'Erase now instead of waiting out the grace period (refused under a legal hold)',
  })
  execute(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.compliance.executeDeletion(id, actor);
  }

  @Put('students/:id/legal-hold')
  @RequireFeature('compliance.manage')
  @Audit('compliance.legal_hold', 'Student')
  legalHold(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LegalHoldDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.compliance.setLegalHold(id, dto.legalHold, actor);
  }

  @Get('students/:id/records-export.zip')
  @RequireAnyFeature('compliance.view', 'family.view', 'report-cards.view.all')
  @ApiOperation({
    summary:
      'A copy of the education records as a zip of JSON files (FERPA); family, counselors, administrators',
  })
  async recordsExport(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const out = await this.compliance.recordsExport(id, actor);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${out.fileName}"`,
    );
    res.send(Buffer.from(out.zip));
  }

  @Get('compliance/incidents')
  @RequireFeature('compliance.view')
  async incidents(
    @Query('organizationId') organizationId: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return { data: await this.compliance.incidents(actor, organizationId) };
  }

  @Post('compliance/incidents')
  @HttpCode(201)
  @RequireFeature('compliance.manage')
  createIncident(
    @Body() dto: CreateIncidentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.compliance.createIncident(dto, actor);
  }

  @Patch('compliance/incidents/:id')
  @RequireFeature('compliance.manage')
  updateIncident(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIncidentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.compliance.updateIncident(id, dto, actor);
  }

  @Post('compliance/incidents/:id/notify')
  @HttpCode(200)
  @RequireFeature('compliance.manage')
  @ApiOperation({
    summary:
      'Notify every administrator now by notification and email, and stamp the clock',
  })
  notifyIncident(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.compliance.notifyIncident(id, actor);
  }
}
