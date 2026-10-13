import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireFeature } from '../access/decorators/access.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CreateIncidentDto, UpdateIncidentDto } from './dto/operations.dto';
import { OperationsService } from './operations.service';

@ApiTags('Operations')
@Controller()
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get('status')
  @Public()
  @ApiOperation({
    summary:
      'Public status page: components, open incidents, planned maintenance and ninety days of uptime',
  })
  status() {
    return this.operations.statusPage();
  }

  @Get('operations/incidents')
  @ApiBearerAuth('bearer')
  @RequireFeature('operations.manage')
  @ApiOperation({
    summary: 'Every incident and maintenance window with its update log',
  })
  incidents(@Query('open') open: string | undefined) {
    return this.operations.incidents(open !== 'true');
  }

  @Post('operations/incidents')
  @ApiBearerAuth('bearer')
  @RequireFeature('operations.manage')
  @ApiOperation({
    summary: 'Open an incident or schedule maintenance (audited)',
  })
  create(
    @Body() dto: CreateIncidentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.operations.createIncident(dto, actor);
  }

  @Patch('operations/incidents/:id')
  @ApiBearerAuth('bearer')
  @RequireFeature('operations.manage')
  @ApiOperation({
    summary:
      'Add an update, move the status, change impact or visibility (audited)',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIncidentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.operations.updateIncident(id, dto, actor);
  }

  @Get('operations/checks')
  @ApiBearerAuth('bearer')
  @RequireFeature('operations.manage')
  @ApiOperation({ summary: 'Recent health checks' })
  checks(@Query('limit') limit: string | undefined) {
    return this.operations.recentChecks(limit ? Number(limit) : 50);
  }

  @Post('operations/checks/run')
  @ApiBearerAuth('bearer')
  @RequireFeature('operations.manage')
  @ApiOperation({
    summary: 'Run a health check now (one runs every five minutes on its own)',
  })
  run() {
    return this.operations.runCheck();
  }
}
