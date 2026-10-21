import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { InjectConfig } from '../../../config/config.module';
import type { AppConfig } from '../../../config/config';

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body; HTML is generated from it with an RTL layout. */
  text: string;
  link?: string | null;
  linkLabel?: string;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** SMTP adapter (tech stack §15). */
@Injectable()
export class EmailChannel {
  private readonly logger = new Logger(EmailChannel.name);
  private transporter: Transporter | null = null;

  constructor(@InjectConfig() private readonly config: AppConfig) {}

  get configured(): boolean {
    return !!this.config.smtp.host;
  }

  private getTransporter(): Transporter {
    const smtp = this.config.smtp;
    this.transporter ??= nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    });
    return this.transporter;
  }

  absoluteLink(link?: string | null): string | null {
    if (!link) return null;
    return link.startsWith('http') ? link : `${this.config.appUrl}${link}`;
  }

  render(message: EmailMessage): string {
    const href = this.absoluteLink(message.link);
    const paragraphs = escapeHtml(message.text)
      .split(/\n{2,}/)
      .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, '<br>')}</p>`)
      .join('');
    const button = href
      ? `<p style="margin:20px 0 0"><a href="${escapeHtml(href)}" style="background:#0f766e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(message.linkLabel ?? 'مشاهده در کاربان')}</a></p>`
      : '';
    return `<!doctype html><html lang="fa" dir="rtl"><body style="margin:0;background:#f4f5f7;font-family:Tahoma,Vazirmatn,sans-serif">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;padding:24px;color:#1f2937;line-height:1.9;direction:rtl;text-align:right">
<div style="font-weight:bold;color:#0f766e;margin-bottom:12px">کاربان</div>
<h2 style="font-size:17px;margin:0 0 12px">${escapeHtml(message.subject)}</h2>
${paragraphs}${button}
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px">
<div style="font-size:12px;color:#6b7280">این پیام به‌صورت خودکار از سامانه مدیریت وظایف کاربان ارسال شده است.</div>
</div></body></html>`;
  }

  async send(message: EmailMessage): Promise<void> {
    if (!this.configured) throw new Error('SMTP is not configured');
    const href = this.absoluteLink(message.link);
    await this.getTransporter().sendMail({
      from: this.config.smtp.from,
      to: message.to,
      subject: message.subject,
      text: href ? `${message.text}\n\n${href}` : message.text,
      html: this.render(message),
    });
    this.logger.debug(`Email sent to ${message.to}: ${message.subject}`);
  }

  async verify(): Promise<boolean> {
    if (!this.configured) return false;
    try {
      await this.getTransporter().verify();
      return true;
    } catch {
      return false;
    }
  }
}
