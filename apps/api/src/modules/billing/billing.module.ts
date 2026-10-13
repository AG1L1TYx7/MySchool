import { Global, Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { UsageService } from './usage.service';

/** Global: the usage interceptor in the app module counts every request through UsageService. */
@Global()
@Module({
  controllers: [BillingController],
  providers: [BillingService, UsageService],
  exports: [BillingService, UsageService],
})
export class BillingModule {}
