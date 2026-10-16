import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import {
  NoPaymentProvider,
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './payment-provider';
import { StripeProvider } from './stripe.provider';

/** The configured card payment provider, or the one that says so when none is (docs/04 section 8). */
@Global()
@Module({
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      useFactory: (config: AppConfigService): PaymentProvider => {
        const key = config.get('STRIPE_SECRET_KEY');
        return key
          ? new StripeProvider(key, config.get('STRIPE_BASE_URL'))
          : new NoPaymentProvider();
      },
      inject: [AppConfigService],
    },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentsModule {}
