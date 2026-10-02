import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WsAuthService } from './ws-auth.service';

/** Shared socket plumbing: handshake authentication. Gateways live with the features they serve. */
@Module({
  imports: [AuthModule],
  providers: [WsAuthService],
  exports: [WsAuthService],
})
export class RealtimeModule {}
