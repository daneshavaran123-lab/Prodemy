import { Injectable, Logger } from '@nestjs/common';
import { NotificationType, TaskEventType, TaskStatus } from '@prisma/client';
import { DAY_MS, OPEN_TASK_STATUSES, delayDays, diffDateKeys, toPersianDigits, zonedDateKey } from '@karban/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InjectConfig } from '../../config/config.module';
import type { AppConfig } from '../../config/config';
import { formatJalali } from '../../common/utils/jalali';
import { recordHistory } from '../tasks/task-history';
import { taskCode } from '../tasks/task.mapper';

const OPEN = OPEN_TASK_STATUSES as TaskStatus[];
const fa = (n: number) => toPersianDigits(n);

/**
 * Deadline reminders (PRD §44, §80) and overdue detection (PRD §27, §81).
 * Idempotent: notification dedupe keys make repeated scans safe.
 */
@Injectable()
export class DeadlineScanner {
  private readonly logger = new Logger(DeadlineScanner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  async scan(now = new Date()): Promise<{ reminders: number; overdue: number }> {
    const overdue = await this.detectOverdue(now);
    const reminders = await this.sendReminders(now);
    if (overdue || reminders) this.logger.log(`Deadline scan: ${overdue} newly overdue, ${reminders} reminders`);
    return { reminders, overdue };
  }

  /** Marks newly missed deadlines, asks the owner for a delay reason and alerts the manager. */
  async detectOverdue(now: Date): Promise<number> {
    const tasks = await this.prisma.task.findMany({
      where: { status: { in: OPEN }, deadline: { lt: now }, overdueAt: null },
      select: {
        id: true,
        number: true,
        title: true,
        deadline: true,
        primaryOwnerId: true,
        managerId: true,
        priority: true,
      },
    });
    for (const t of tasks) {
      const marked = await this.prisma.$transaction(async (tx) => {
        const res = await tx.task.updateMany({ where: { id: t.id, overdueAt: null }, data: { overdueAt: now } });
        if (!res.count) return false;
        await recordHistory(tx, t.id, null, [
          {
            eventType: TaskEventType.MARKED_OVERDUE,
            field: 'deadline',
            newValue: { deadline: t.deadline.toISOString() },
          },
        ]);
        return true;
      });
      if (!marked) continue;
      const label = `«${t.title}» (${taskCode(t.number)})`;
      const key = `overdue:${t.id}:${t.deadline.toISOString()}`;
      await this.notifications.notify({
        employeeIds: [t.primaryOwnerId],
        type: NotificationType.DELAY_REASON_REQUIRED,
        title: `مهلت گذشت: ${t.title}`,
        body: `مهلت وظیفه ${label} به پایان رسید و وظیفه عقب‌افتاده شد. لطفاً وضعیت را به‌روزرسانی و دلیل تأخیر را ثبت کنید.`,
        taskId: t.id,
        dedupeKey: `${key}:owner`,
      });
      if (t.managerId !== t.primaryOwnerId) {
        await this.notifications.notify({
          employeeIds: [t.managerId],
          type: NotificationType.TASK_OVERDUE,
          title: `وظیفه عقب‌افتاده: ${t.title}`,
          body: `مهلت وظیفه ${label} گذشته و هنوز تکمیل نشده است.`,
          taskId: t.id,
          dedupeKey: `${key}:manager`,
        });
      }
    }
    return tasks.length;
  }

  /**
   * Sends the reminder whose offset (days relative to the deadline day) matches today,
   * e.g. defaults −3, −1, 0, +1, +3. Changing the deadline yields new dedupe keys.
   */
  async sendReminders(now: Date): Promise<number> {
    const settings = await this.settings.get();
    const offsets = settings.reminderOffsetsDays;
    if (!offsets.length) return 0;
    const tz = this.config.timeZone;
    const todayKey = zonedDateKey(now, tz);
    const minOffset = Math.min(...offsets);
    const maxOffset = Math.max(...offsets);
    const tasks = await this.prisma.task.findMany({
      where: {
        status: { in: OPEN },
        deadline: {
          gte: new Date(now.getTime() - (maxOffset + 1) * DAY_MS),
          lte: new Date(now.getTime() + (-minOffset + 1) * DAY_MS),
        },
      },
      select: {
        id: true,
        number: true,
        title: true,
        deadline: true,
        primaryOwnerId: true,
        managerId: true,
        createdAt: true,
      },
    });
    let sent = 0;
    for (const t of tasks) {
      const dayOffset = diffDateKeys(zonedDateKey(t.deadline, tz), todayKey);
      if (!offsets.includes(dayOffset)) continue;
      // A brand-new task does not need a "deadline approaching" reminder minutes after assignment.
      if (dayOffset < 0 && now.getTime() - t.createdAt.getTime() < 12 * 3600 * 1000) continue;
      if (dayOffset === 0 && t.deadline < now) continue; // overdue detection covers it
      const label = `«${t.title}» (${taskCode(t.number)})`;
      const when = formatJalali(t.deadline, tz, { weekday: true, withTime: true });
      const key = `reminder:${t.id}:${t.deadline.toISOString()}:${dayOffset}`;
      let created = 0;
      if (dayOffset < 0) {
        created = await this.notifications.notify({
          employeeIds: [t.primaryOwnerId],
          type: NotificationType.DEADLINE_APPROACHING,
          title: `یادآوری: ${fa(-dayOffset)} روز تا مهلت ${t.title}`,
          body: `مهلت وظیفه ${label}: ${when}`,
          taskId: t.id,
          dedupeKey: key,
        });
      } else if (dayOffset === 0) {
        created = await this.notifications.notify({
          employeeIds: [t.primaryOwnerId],
          type: NotificationType.DEADLINE_REACHED,
          title: `مهلت امروز: ${t.title}`,
          body: `مهلت وظیفه ${label} امروز (${when}) به پایان می‌رسد.`,
          taskId: t.id,
          dedupeKey: key,
        });
      } else {
        const late = delayDays(t.deadline, now);
        created = await this.notifications.notify({
          employeeIds: [t.primaryOwnerId, t.managerId],
          type: NotificationType.TASK_OVERDUE,
          title: `${fa(late)} روز تأخیر: ${t.title}`,
          body: `وظیفه ${label} ${fa(late)} روز از مهلت (${when}) عقب است.`,
          taskId: t.id,
          dedupeKey: key,
        });
      }
      sent += created;
    }
    return sent;
  }
}
