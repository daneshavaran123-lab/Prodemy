import { Injectable, Logger } from '@nestjs/common';
import { InjectConfig } from '../../../config/config.module';
import type { AppConfig } from '../../../config/config';

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number; username?: string; first_name?: string };
    text?: string;
  };
}

/**
 * Telegram Bot API adapter (PRD §45). Telegram is a notification channel only:
 * messages carry a link back to the web app, where every action happens.
 */
@Injectable()
export class TelegramChannel {
  private readonly logger = new Logger(TelegramChannel.name);

  constructor(@InjectConfig() private readonly config: AppConfig) {}

  get configured(): boolean {
    return !!this.config.telegram.token && this.config.telegram.mode !== 'disabled';
  }

  get botUsername(): string | undefined {
    return this.config.telegram.botUsername;
  }

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const { apiBase, token } = this.config.telegram;
    const res = await fetch(`${apiBase}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(method === 'getUpdates' ? 40_000 : 10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
    if (!res.ok || !json.ok) {
      throw new Error(`Telegram ${method} failed: ${json.description ?? res.status}`);
    }
    return json.result as T;
  }

  /** Telegram rejects inline-button URLs that point at localhost / private hosts. */
  private isPublicUrl(url: string): boolean {
    try {
      const host = new URL(url).hostname;
      return !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) && host.includes('.');
    } catch {
      return false;
    }
  }

  async sendMessage(chatId: string, text: string, link?: string | null): Promise<void> {
    if (!this.configured) throw new Error('Telegram is not configured');
    const href = link ? (link.startsWith('http') ? link : `${this.config.appUrl}${link}`) : null;
    const useButton = href && this.isPublicUrl(href);
    await this.call('sendMessage', {
      chat_id: chatId,
      text: href && !useButton ? `${text}\n\n${href}` : text,
      disable_web_page_preview: true,
      ...(useButton ? { reply_markup: { inline_keyboard: [[{ text: 'مشاهده در کاربان', url: href }]] } } : {}),
    });
  }

  getUpdates(offset: number): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>('getUpdates', {
      offset,
      timeout: 30,
      allowed_updates: ['message'],
    });
  }

  async setWebhook(url: string, secret?: string): Promise<void> {
    await this.call('setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: ['message'],
      drop_pending_updates: false,
    });
    this.logger.log(`Telegram webhook registered at ${url}`);
  }

  async deleteWebhook(): Promise<void> {
    await this.call('deleteWebhook', { drop_pending_updates: false });
  }

  async getMe(): Promise<{ username?: string } | null> {
    if (!this.configured) return null;
    try {
      return await this.call<{ username?: string }>('getMe', {});
    } catch {
      return null;
    }
  }
}
