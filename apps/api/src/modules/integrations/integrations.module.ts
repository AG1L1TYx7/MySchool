import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GradebookModule } from '../gradebook/gradebook.module';
import { ApiKeysService } from './api-keys.service';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { IntegrationsController } from './integrations.controller';
import { LtiController } from './lti.controller';
import { LtiService } from './lti.service';
import { LtiLinksController } from './lti-links.controller';
import { LtiPlatformController } from './lti-platform.controller';
import { LtiPlatformService } from './lti-platform.service';
import { LtiServicesController } from './lti-services.controller';
import { LtiServicesListener } from './lti-services.listener';
import { LtiServicesService } from './lti-services.service';
import { WebhooksService } from './webhooks.service';

/** Global so the authentication guard can resolve API keys. */
@Global()
@Module({
  imports: [AuthModule, GradebookModule],
  controllers: [
    IntegrationsController,
    LtiController,
    LtiServicesController,
    LtiPlatformController,
    LtiLinksController,
    ExportsController,
  ],
  providers: [
    WebhooksService,
    ApiKeysService,
    ExportsService,
    LtiService,
    LtiServicesService,
    LtiServicesListener,
    LtiPlatformService,
  ],
  exports: [ApiKeysService, WebhooksService],
})
export class IntegrationsModule {}
