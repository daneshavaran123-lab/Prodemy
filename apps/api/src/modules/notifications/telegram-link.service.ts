import { Injectable, Logger } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InjectConfig } from '../../config/config.module';
import type { AppConfig } from '../../config/config';
import { TelegramChannel, type TelegramUpdate } from './channels/telegram.channel';
import { Errors } from '../../common/errors';

const LINK_TTL_MS = 15 * 60 * 1000;
const POLL_OFFSET_KEY = 'telegram.pollOffset';

/**
 * Binds a Karban user to a Telegram chat via a one-time `/start <code>` deep link,
 * and processes incoming bot updates (webhook or long polling).
 */
@Injectable()
export class TelegramLinkService {
  private readonly logger = new Logger(TelegramLinkService.name);
  private polling = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly telegram: TelegramChannel,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  async createLink(userId: string) {
    if (!this.telegram.configured) {
      throw Errors.validation('اتصال تلگرام توسط مدیر سیستم پیکربندی نشده است.');
    }
    const code = randomBytes(9).toString('base64url');
    const expiresAt = new Date(Date.now() + LINK_TTL_MS);
    await this.prisma.telegramLinkToken.create({ data: { userId, code, expiresAt } });
    const bot = this.telegram.botUsername ?? (await this.telegram.getMe())?.username;
    return {
      code,
      expiresAt: expiresAt.toISOString(),
      deepLink: bot ? `https://t.me/${bot}?start=${code}` : null,
      command: `/start ${code}`,
    };
  }

  async unlink(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { telegramChatId: null, telegramLinkedAt: null },
    });
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const msg = update.message;
    if (!msg?.text || msg.chat.type !== 'private') return;
    const chatId = String(msg.chat.id);
    const [command, arg] = msg.text.trim().split(/\s+/, 2);

    if (command === '/start' && arg) {
      const token = await this.prisma.telegramLinkToken.findUnique({ where: { code: arg } });
      if (!token || token.usedAt || token.expiresAt < new Date()) {
        await this.safeReply(chatId, 'کد اتصال نامعتبر یا منقضی شده است. از صفحه پروفایل در کاربان کد جدید بگیرید.');
        return;
      }
      await this.prisma.$transaction([
        // A chat can only be bound to one account.
        this.prisma.user.updateMany({ where: { telegramChatId: chatId }, data: { telegramChatId: null } }),
        this.prisma.user.update({
          where: { id: token.userId },
          data: { telegramChatId: chatId, telegramLinkedAt: new Date() },
        }),
        this.prisma.telegramLinkToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
      ]);
      await this.safeReply(
        chatId,
        'حساب تلگرام شما با موفقیت به کاربان متصل شد. از این پس یادآوری‌ها و هشدارهای مهم اینجا ارسال می‌شوند.\nتمام عملیات روی وظایف از طریق وب‌اپلیکیشن کاربان انجام می‌شود.',
      );
      return;
    }
    if (command === '/stop') {
      await this.prisma.user.updateMany({
        where: { telegramChatId: chatId },
        data: { telegramChatId: null, telegramLinkedAt: null },
      });
      await this.safeReply(chatId, 'اتصال این گفتگو با کاربان قطع شد.');
      return;
    }
    await this.safeReply(
      chatId,
      `این ربات فقط برای ارسال اعلان‌های کاربان است.\nبرای مشاهده و مدیریت وظایف به ${this.config.appUrl} مراجعه کنید.`,
    );
  }

  private async safeReply(chatId: string, text: string) {
    try {
      await this.telegram.sendMessage(chatId, text);
    } catch (err) {
      this.logger.warn(`Telegram reply failed: ${(err as Error).message}`);
    }
  }

  verifyWebhookSecret(secret: string | undefined): boolean {
    const expected = this.config.telegram.webhookSecret;
    return !!expected && secret === expected;
  }

  /** Configures the bot transport on worker start-up. */
  async start(): Promise<void> {
    if (!this.telegram.configured) return;
    try {
      if (this.config.telegram.mode === 'webhook') {
        await this.telegram.setWebhook(
          `${this.config.appUrl}/api/integrations/telegram/webhook`,
          this.config.telegram.webhookSecret,
        );
      } else if (this.config.telegram.mode === 'polling') {
        await this.telegram.deleteWebhook();
        void this.pollLoop();
      }
    } catch (err) {
      await this.audit.log({
        action: AuditAction.INTEGRATION_ERROR,
        entityType: 'Telegram',
        metadata: { error: (err as Error).message },
      });
      this.logger.error(`Telegram start failed: ${(err as Error).message}`);
    }
  }

  stop() {
    this.polling = false;
  }

  private async pollLoop() {
    this.polling = true;
    this.logger.log('Telegram long polling started');
    const row = await this.prisma.systemSetting.findUnique({ where: { key: POLL_OFFSET_KEY } });
    let offset = (row?.value as number | undefined) ?? 0;
    while (this.polling) {
      try {
        const updates = await this.telegram.getUpdates(offset);
        for (const u of updates) {
          offset = Math.max(offset, u.update_id + 1);
          await this.handleUpdate(u).catch((e) => this.logger.warn(e.message));
        }
        if (updates.length) {
          await this.prisma.systemSetting.upsert({
            where: { key: POLL_OFFSET_KEY },
            create: { key: POLL_OFFSET_KEY, value: offset },
            update: { value: offset },
          });
        }
      } catch (err) {
        this.logger.warn(`Telegram polling error: ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
  }
}
