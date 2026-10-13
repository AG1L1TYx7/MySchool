import { Module } from '@nestjs/common';
import { HealthModule } from '../health/health.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { SecurityPolicyGuard } from './security-policy.guard';

@Module({
  imports: [HealthModule],
  controllers: [OperationsController],
  providers: [OperationsService, SecurityPolicyGuard],
  exports: [OperationsService, SecurityPolicyGuard],
})
export class OperationsModule {}
