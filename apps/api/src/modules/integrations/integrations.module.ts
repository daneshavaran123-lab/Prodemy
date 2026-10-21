import { Body, Controller, Get, HttpCode, Module, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuditAction } from '@prisma/client';
import { IsEmail } from 'class-validator';
import { Permission, type IntegrationStatus } from '@karban/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { Errors } from '../../common/errors';
import { InjectConfig } from '../../config/config.module';
import type { AppConfig } from '../../config/config';
import { AuditService } from '../audit/audit.service';
import { AiService } from '../ai/ai.service';
import { EmailChannel } from '../notifications/channels/email.channel';
import { TelegramChannel } from '../notifications/channels/telegram.channel';
import { QueueService } from '../queue/queue.service';

class TestEmailDto {
  @IsEmail()
  to: string;
}

/** Integration status & connectivity tests for the admin screen (PRD §110). Secrets stay in env vars. */
@ApiTags('integrations')
@Controller('integrations')
@RequirePermissions(Permission.INTEGRATION_MANAGE)
export class IntegrationsController {
  constructor(
    @InjectConfig() private readonly config: AppConfig,
    private readonly email: EmailChannel,
    private readonly telegram: TelegramChannel,
    private readonly ai: AiService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
  ) {}

  @Get('status')
  async status(): Promise<IntegrationStatus> {
    return {
      email: { configured: this.email.configured, host: this.config.smtp.host ?? null, from: this.config.smtp.from },
      telegram: {
        configured: this.telegram.configured,
        mode: this.config.telegram.mode,
        botUsername: this.config.telegram.botUsername ?? null,
      },
      ai: this.ai.status(),
      storage: { driver: this.config.storage.driver, bucket: this.config.storage.s3.bucket ?? null },
      queue: { connected: await this.queue.isHealthy() },
    };
  }

  @Post('email/test')
  @HttpCode(200)
  async testEmail(@CurrentUser() ctx: AuthContext, @Body() dto: TestEmailDto) {
    if (!this.email.configured) throw Errors.validation('سرور ایمیل (SMTP) پیکربندی نشده است.');
    try {
      await this.email.send({
        to: dto.to,
        subject: 'ایمیل آزمایشی کاربان',
        text: 'اتصال سرور ایمیل کاربان با موفقیت برقرار است.',
      });
      return { ok: true };
    } catch (err) {
      await this.audit.logFor(ctx, {
        action: AuditAction.INTEGRATION_ERROR,
        entityType: 'Email',
        metadata: { error: (err as Error).message },
      });
      throw Errors.validation(`ارسال ایمیل ناموفق بود: ${(err as Error).message}`);
    }
  }

  @Post('ai/test')
  @HttpCode(200)
  async testAi(@CurrentUser() ctx: AuthContext) {
    const res = await this.ai.completeText(
      'connectivity-test',
      { system: 'Reply with one short Persian word.', user: 'سلام', maxTokens: 10 },
      ctx.userId,
    );
    return res.ok ? { ok: true, model: res.model, reply: res.data } : { ok: false, error: res.error };
  }
}

@Module({ controllers: [IntegrationsController] })
export class IntegrationsModule {}
