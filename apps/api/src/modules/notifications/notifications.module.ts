import { Global, Module } from '@nestjs/common';
import { EmailChannel } from './channels/email.channel';
import { TelegramChannel } from './channels/telegram.channel';
import { NotificationsController, TelegramWebhookController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { TelegramLinkService } from './telegram-link.service';

@Global()
@Module({
  controllers: [NotificationsController, TelegramWebhookController],
  providers: [NotificationsService, TelegramLinkService, EmailChannel, TelegramChannel],
  exports: [NotificationsService, TelegramLinkService, EmailChannel, TelegramChannel],
})
export class NotificationsModule {}
