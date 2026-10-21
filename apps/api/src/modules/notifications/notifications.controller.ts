import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DeliveryStatus, NotificationChannel } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { Permission } from '@karban/shared';
import { CurrentUser, Public, RequirePermissions, SkipCsrf } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { PaginationQuery, ToBoolean } from '../../common/dto';
import { Errors } from '../../common/errors';
import { NotificationsService } from './notifications.service';
import { TelegramLinkService } from './telegram-link.service';
import type { TelegramUpdate } from './channels/telegram.channel';

class ListNotificationsQuery extends PaginationQuery {
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  unreadOnly?: boolean;
}

class PreferencesDto {
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  telegramEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  digestEnabled?: boolean;
}

class DeliveriesQuery extends PaginationQuery {
  @IsOptional()
  @IsEnum(DeliveryStatus)
  status?: DeliveryStatus;

  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;
}

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly telegramLink: TelegramLinkService,
  ) {}

  @Get()
  list(@CurrentUser() ctx: AuthContext, @Query() q: ListNotificationsQuery) {
    return this.notifications.list(ctx.userId, q);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() ctx: AuthContext) {
    return { count: await this.notifications.unreadCount(ctx.userId) };
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() ctx: AuthContext) {
    return { updated: await this.notifications.markAllRead(ctx.userId) };
  }

  @Post(':id/read')
  @HttpCode(204)
  read(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(ctx.userId, id);
  }

  @Get('preferences')
  preferences(@CurrentUser() ctx: AuthContext) {
    return this.notifications.getPreferences(ctx.userId);
  }

  @Patch('preferences')
  updatePreferences(@CurrentUser() ctx: AuthContext, @Body() dto: PreferencesDto) {
    return this.notifications.updatePreferences(ctx.userId, dto);
  }

  @Post('telegram/link')
  telegramLinkCreate(@CurrentUser() ctx: AuthContext) {
    return this.telegramLink.createLink(ctx.userId);
  }

  @Delete('telegram/link')
  @HttpCode(204)
  telegramUnlink(@CurrentUser() ctx: AuthContext) {
    return this.telegramLink.unlink(ctx.userId);
  }

  @Get('deliveries')
  @RequirePermissions(Permission.INTEGRATION_MANAGE)
  deliveries(@Query() q: DeliveriesQuery) {
    return this.notifications.listDeliveries(q);
  }

  @Post('deliveries/:id/retry')
  @HttpCode(204)
  @RequirePermissions(Permission.INTEGRATION_MANAGE)
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.retryDelivery(id);
  }
}

@ApiTags('integrations')
@Controller('integrations/telegram')
export class TelegramWebhookController {
  constructor(private readonly telegramLink: TelegramLinkService) {}

  @Post('webhook')
  @Public()
  @SkipCsrf()
  @HttpCode(200)
  async webhook(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() update: TelegramUpdate,
  ) {
    if (!this.telegramLink.verifyWebhookSecret(secret)) throw Errors.forbidden();
    await this.telegramLink.handleUpdate(update);
    return { ok: true };
  }
}
