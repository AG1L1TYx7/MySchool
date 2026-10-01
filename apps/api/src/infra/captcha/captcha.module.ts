import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { CaptchaService } from './captcha.service';

@Global()
@Module({
  providers: [
    {
      provide: CaptchaService,
      useFactory: (config: AppConfigService) => new CaptchaService(config),
      inject: [AppConfigService],
    },
  ],
  exports: [CaptchaService],
})
export class CaptchaModule {}
