import { Global, Module } from '@nestjs/common';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { FeatureFlagService } from './feature-flag.service';
import { AccessGuard } from './guards/access.guard';
import { PermissionService } from './permission.service';

@Global()
@Module({
  controllers: [AccessController],
  providers: [
    PermissionService,
    FeatureFlagService,
    AccessService,
    AccessGuard,
  ],
  exports: [PermissionService, FeatureFlagService, AccessGuard],
})
export class AccessModule {}
