import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RequireFeature } from '../access/decorators/access.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ExportsService } from './exports.service';
import { LtiService } from './lti.service';

/** Files other platforms import: Canvas and Google Classroom grade sheets, a Common Cartridge of the class. */
@ApiTags('Integrations')
@ApiBearerAuth('bearer')
@Controller('classes/:classId')
export class ExportsController {
  constructor(
    private readonly exports: ExportsService,
    private readonly lti: LtiService,
  ) {}

  @Get('exports/canvas-gradebook.csv')
  @RequireFeature('grades.export')
  @ApiOperation({ summary: 'Gradebook in the layout Canvas imports (audited)' })
  async canvas(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const out = await this.exports.canvasCsv(classId, actor);
    this.sendCsv(res, out.fileName, out.csv);
  }

  @Get('exports/google-classroom.csv')
  @RequireFeature('grades.export')
  @ApiOperation({
    summary: 'Grade sheet in the layout Google Classroom uses (audited)',
  })
  async classroom(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const out = await this.exports.googleClassroomCsv(classId, actor);
    this.sendCsv(res, out.fileName, out.csv);
  }

  @Get('exports/common-cartridge.imscc')
  @RequireFeature('assignments.view')
  @ApiOperation({
    summary:
      'IMS Common Cartridge 1.3 of the published assignments (teacher or administrator; audited)',
  })
  async cartridge(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const out = await this.exports.commonCartridge(classId, actor);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${out.fileName}"`,
    );
    res.send(Buffer.from(out.zip));
  }

  @Get('lti-tools')
  @RequireFeature('lti.launch')
  @ApiOperation({
    summary: 'External tools that can be opened from this class',
  })
  tools(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.lti.toolsForClass(classId, actor);
  }

  private sendCsv(res: Response, fileName: string, csv: string) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(csv);
  }
}
