import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireFeature } from '../access/decorators/access.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { FamilyService } from './family.service';

@ApiTags('Family')
@ApiBearerAuth('bearer')
@Controller('family')
export class FamilyController {
  constructor(private readonly family: FamilyService) {}

  @Get('home')
  @RequireFeature('family.view')
  @ApiOperation({
    summary:
      'Every child of the signed-in parent (or the student): classes and grades, attendance, missing and upcoming work, recent grades',
  })
  home(@CurrentUser() actor: AuthenticatedUser) {
    return this.family.home(actor);
  }

  @Get('digest')
  @RequireFeature('family.view')
  @ApiOperation({
    summary:
      'The weekly digest as it would be emailed, in the parent’s language',
  })
  digest(@CurrentUser() actor: AuthenticatedUser) {
    return this.family.digestPreview(actor);
  }
}
