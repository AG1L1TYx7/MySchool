import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomInt } from 'node:crypto';
import { newId } from '../../common/utils/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RequireFeature } from '../access/decorators/access.decorators';
import { assertOrganizationAccess } from '../access/scope';
import { Audit } from '../audit/audit.decorator';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

/** Letters and digits that are hard to confuse when read aloud or typed. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateJoinCode(): string {
  const part = () =>
    Array.from(
      { length: 4 },
      () => ALPHABET[randomInt(0, ALPHABET.length)],
    ).join('');
  return `${part()}-${part()}`;
}

/**
 * The join code lets students and parents attach themselves to a school at registration
 * (docs/11 section 3). Administrators can read it and rotate it; rotation invalidates the old one.
 */
@ApiTags('Organisations')
@ApiBearerAuth('bearer')
@Controller('organizations')
export class JoinCodeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get(':id/join-code')
  @RequireFeature('organizations.manage')
  @ApiOperation({ summary: 'Current join code for self-registration' })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    assertOrganizationAccess(actor, id);
    const org = await this.prisma.organization.findFirstOrThrow({
      where: { id, deletedAt: null },
      select: { joinCode: true, joinCodeRotatedAt: true },
    });
    return { joinCode: org.joinCode, rotatedAt: org.joinCodeRotatedAt };
  }

  @Post(':id/join-code')
  @HttpCode(200)
  @RequireFeature('organizations.manage')
  @Audit('organizations.join_code_rotated', 'Organization')
  @ApiOperation({
    summary: 'Rotate the join code (the old one stops working immediately)',
  })
  async rotate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    assertOrganizationAccess(actor, id);
    for (let attempt = 0; attempt < 5; attempt++) {
      const joinCode = generateJoinCode();
      const clash = await this.prisma.organization.count({
        where: { joinCode },
      });
      if (clash) continue;
      const org = await this.prisma.organization.update({
        where: { id },
        data: { joinCode, joinCodeRotatedAt: new Date() },
        select: { joinCode: true, joinCodeRotatedAt: true },
      });
      await this.audit.record({
        userId: actor.id,
        organizationId: id,
        action: 'organizations.join_code_rotated',
        entityType: 'Organization',
        entityId: id,
      });
      return { joinCode: org.joinCode, rotatedAt: org.joinCodeRotatedAt };
    }
    throw new Error(`Could not allocate a join code (audit ${newId()})`);
  }
}
