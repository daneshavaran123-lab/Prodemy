import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NotificationType, Prisma, UserStatus } from '@prisma/client';
import { Permission, weekdayOfKey, zonedDateKey } from '@karban/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RiskService } from '../risk/risk.service';
import { PerformanceService } from '../performance/performance.service';
import { AiFeaturesService } from '../ai/ai-features.service';
import { AuthContextLoader } from '../auth/auth-context.loader';
import { InjectConfig } from '../../config/config.module';
import type { AppConfig } from '../../config/config';
import { currentJalaliPeriod, jalaliParts } from '../../common/utils/jalali';
import { DeadlineScanner } from './deadline.scanner';
import { RecurrenceRunner } from './recurrence.runner';
import { weekStart } from '../dashboard/metrics';

export const JOBS = {
  deadlines: 'scheduler.deadlines',
  recurrence: 'scheduler.recurrence',
  risk: 'scheduler.risk',
  hourly: 'scheduler.hourly',
} as const;

/**
 * Background schedule (tech stack §11). With Redis the worker process runs BullMQ job
 * schedulers; with the inline driver (single-process dev) plain intervals are used.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly risk: RiskService,
    private readonly performance: PerformanceService,
    private readonly ai: AiFeaturesService,
    private readonly contexts: AuthContextLoader,
    private readonly deadlines: DeadlineScanner,
    private readonly recurrence: RecurrenceRunner,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    this.queue.register(JOBS.deadlines, async () => {
      await this.deadlines.scan();
    });
    this.queue.register(JOBS.recurrence, async () => {
      await this.recurrence.run();
    });
    this.queue.register(JOBS.risk, async () => {
      await this.risk.refresh();
    });
    this.queue.register(JOBS.hourly, () => this.hourly());
  }

  /** Called by the worker process (or the API itself when using the inline driver). */
  async start() {
    const every = this.config.schedulerIntervalMinutes * 60_000;
    if (this.queue.driver === 'redis') {
      await this.queue.schedule(JOBS.deadlines, every);
      await this.queue.schedule(JOBS.recurrence, every);
      await this.queue.schedule(JOBS.risk, every);
      await this.queue.schedule(JOBS.hourly, 60 * 60_000);
      this.logger.log(`Job schedulers registered (every ${this.config.schedulerIntervalMinutes} min)`);
      return;
    }
    const run = (name: string) => () => void this.queue.enqueue(name, {});
    this.timers.push(setInterval(run(JOBS.recurrence), every));
    this.timers.push(setInterval(run(JOBS.deadlines), every));
    this.timers.push(setInterval(run(JOBS.risk), every));
    this.timers.push(setInterval(run(JOBS.hourly), 60 * 60_000));
    setTimeout(() => {
      run(JOBS.recurrence)();
      run(JOBS.deadlines)();
      run(JOBS.risk)();
    }, 5_000);
    this.logger.log('In-process scheduler started (inline queue driver)');
  }

  onModuleDestroy() {
    this.timers.forEach(clearInterval);
  }

  /** Runs a job at most once per period key (stored in SystemSetting). */
  private async once(job: string, periodKey: string, fn: () => Promise<void>) {
    const key = `job.${job}.last`;
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (row?.value === periodKey) return;
    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: periodKey as Prisma.InputJsonValue },
      update: { value: periodKey as Prisma.InputJsonValue },
    });
    await fn();
  }

  /** Hourly housekeeping: email digest, weekly summaries, monthly performance snapshot. */
  async hourly(now = new Date()) {
    const tz = this.config.timeZone;
    const s = await this.settings.get();
    const hour = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now),
    );
    const today = zonedDateKey(now, tz);

    if (hour >= s.digestHour) {
      await this.once('digest', today, async () => {
        const sent = await this.notifications.sendDigests();
        this.logger.log(`Digest emails sent: ${sent}`);
      });
    }
    if (weekdayOfKey(today) === s.weeklySummaryDay && hour >= s.weeklySummaryHour) {
      await this.once('weekly-summary', weekStart(now, tz).toISOString(), () => this.weeklySummaries(now));
    }
    if (jalaliParts(now, tz).day === 1) {
      const previous = currentJalaliPeriod(now, tz, -1);
      await this.once('performance-snapshot', previous, async () => {
        const r = await this.performance.snapshot(previous);
        this.logger.log(`Performance snapshot ${r.period}: ${r.records} records`);
      });
    }
    await this.prisma.session.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } } });
  }

  /** Weekly summary to every manager (PRD §46 "Weekly Summary", §84). */
  async weeklySummaries(now = new Date()) {
    const managers = await this.prisma.user.findMany({
      where: {
        status: UserStatus.ACTIVE,
        role: {
          permissions: {
            some: {
              permission: {
                code: {
                  in: [Permission.REPORT_VIEW_TEAM, Permission.REPORT_VIEW_DEPARTMENT, Permission.REPORT_VIEW_ALL],
                },
              },
            },
          },
        },
      },
      select: { id: true },
    });
    let sent = 0;
    for (const m of managers) {
      try {
        const ctx = await this.contexts.load(m.id, 'system');
        if (!ctx) continue;
        const summary =
          ctx.scopes.report === 'all'
            ? await this.ai.executiveSummary(ctx, 'week', now)
            : await this.ai.managerSummary(ctx, undefined, now);
        const body = [
          summary.aiText ?? summary.text,
          ...(summary.highlights.length ? ['', 'موارد نیازمند توجه:', ...summary.highlights.map((h) => `• ${h}`)] : []),
        ].join('\n');
        sent += await this.notifications.notify({
          userIds: [m.id],
          type: NotificationType.WEEKLY_SUMMARY,
          title: 'خلاصه هفتگی وضعیت وظایف',
          body,
          link: ctx.scopes.report === 'all' ? '/organization' : '/manager',
          dedupeKey: `weekly:${weekStart(now, this.config.timeZone).toISOString()}`,
        });
      } catch (err) {
        this.logger.warn(`Weekly summary for ${m.id} failed: ${(err as Error).message}`);
      }
    }
    this.logger.log(`Weekly summaries sent: ${sent}`);
  }
}
