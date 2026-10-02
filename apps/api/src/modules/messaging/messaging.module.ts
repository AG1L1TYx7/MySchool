import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { RealtimeModule } from '../realtime/realtime.module';
import {
  ConversationsController,
  MessagesController,
} from './messaging.controller';
import { MessagingGateway } from './messaging.gateway';
import { MessagingService } from './messaging.service';

@Module({
  imports: [RealtimeModule, FilesModule],
  controllers: [ConversationsController, MessagesController],
  providers: [MessagingGateway, MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
