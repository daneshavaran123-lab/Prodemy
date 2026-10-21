import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  AuditAction,
  DeliveryStatus,
  NotificationChannel,
  NotificationPriority,
  NotificationType,
  Prisma,
  UserStatus,
} from '@prisma/client';
import type { NotificationDeliveryDto, NotificationDto, NotificationPreferences, Paginated } from '@karban/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { AuditService } from '../audit/audit.service';
import { EmailChannel } from './channels/email.channel';
import { TelegramChannel } from './channels/telegram.channel';
import { Errors } from '../../common/errors';

export const JOB_DELIVER = 'notification.deliver';
export const JOB_EMAIL = 'email.send';

/** Default urgency per event (PRD §47: critical & mentions immediate, low activity → digest). */
const DEFAULT_PRIORITY: Record<NotificationType, NotificationPriority> = {
  TASK_ASSIGNED: 'NORMAL',
  TASK_REASSIGNED: 'NORMAL',
  COLLABORATOR_ADDED: 'NORMAL',
  DEADLINE_APPROACHING: 'NORMAL',
  DEADLINE_REACHED: 'CRITICAL',
  TASK_OVERDUE: 'CRITICAL',
  DELAY_REASON_REQUIRED: 'CRITICAL',
  COMMENT_ADDED: 'LOW',
  MENTIONED: 'CRITICAL',
  TASK_BLOCKED: 'CRITICAL',
  PRIORITY_CHANGED: 'LOW',
  DEADLINE_CHANGED: 'NORMAL',
  TASK_COMPLETED: 'NORMAL',
  TASK_ACCEPTED: 'LOW',
  TASK_REOPENED: 'NORMAL',
  TASK_CANCELLED: 'NORMAL',
  OWNER_DEACTIVATED: 'CRITICAL',
  ACCOUNT_PENDING_APPROVAL: 'NORMAL',
  WEEKLY_SUMMARY: 'NORMAL',
  DIGEST: 'LOW',
  SYSTEM: 'NORMAL',
};

export interface NotifyInput {
  userIds?: string[];
  employeeIds?: string[];
  type: NotificationType;
  priority?: NotificationPriority;
  title: string;
  body: string;
  taskId?: string | null;
  link?: string | null;
  /** When set, a recipient never receives two notifications with the same key. */
  dedupeKey?: string;
  /** Actor's employee id — people are not notified about their own actions. */
  actorEmployeeId?: string | null;
  /** Skip external channels (in-app only). */
  inAppOnly?: boolean;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    private readonly email: EmailChannel,
    private readonly telegram: TelegramChannel,
  ) {}

  onModuleInit() {
    this.queue.register(JOB_DELIVER, (data: { deliveryId: string; final?: boolean }) =>
      this.processDelivery(data.deliveryId),
    );
    this.queue.register(JOB_EMAIL, async (data: { to: string; subject: string; text: string; link?: string }) => {
      try {
        await this.email.send(data);
      } catch (err) {
        await this.audit.log({
          action: AuditAction.NOTIFICATION_FAILURE,
          entityType: 'Email',
          metadata: { to: data.to, subject: data.subject, error: (err as Error).message },
        });
        if (this.queue.driver !== 'inline') throw err;
      }
    });
  }

  /** Creates in-app notifications and schedules external deliveries. Returns notifications created. */
  async notify(input: NotifyInput): Promise<number> {
    const priority = input.priority ?? DEFAULT_PRIORITY[input.type];
    const users = await this.resolveRecipients(input);
    let created = 0;
    for (const user of users) {
      if (input.actorEmployeeId && user.employeeId === input.actorEmployeeId) continue;
      const dedupeKey = input.dedupeKey ? `${input.dedupeKey}:${user.id}` : undefined;
      const deliveries: Prisma.NotificationDeliveryCreateWithoutNotificationInput[] = [];
      if (!input.inAppOnly) {
        if (user.email && user.emailNotifications && this.email.configured) {
          // LOW priority emails wait for the digest; they stay PENDING and are not enqueued.
          if (priority !== 'LOW' || user.digestEnabled) {
            deliveries.push({ channel: NotificationChannel.EMAIL });
          }
        }
        if (priority !== 'LOW' && user.telegramChatId && user.telegramNotifications && this.telegram.configured) {
          deliveries.push({ channel: NotificationChannel.TELEGRAM });
        }
      }
      try {
        const notification = await this.prisma.notification.create({
          data: {
            userId: user.id,
            type: input.type,
            priority,
            title: input.title.slice(0, 300),
            body: input.body.slice(0, 4000),
            taskId: input.taskId ?? null,
            link: input.link ?? (input.taskId ? `/tasks/${input.taskId}` : null),
            dedupeKey,
            deliveries: { create: deliveries },
          },
          include: { deliveries: true },
        });
        created++;
        for (const d of notification.deliveries) {
          if (priority === 'LOW' && d.channel === NotificationChannel.EMAIL) continue;
          await this.queue.enqueue(JOB_DELIVER, { deliveryId: d.id });
        }
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
    }
    return created;
  }

  private async resolveRecipients(input: NotifyInput) {
    const or: Prisma.UserWhereInput[] = [];
    if (input.userIds?.length) or.push({ id: { in: [...new Set(input.userIds)] } });
    if (input.employeeIds?.length) or.push({ employeeId: { in: [...new Set(input.employeeIds)] } });
    if (!or.length) return [];
    return this.prisma.user.findMany({
      where: { status: UserStatus.ACTIVE, OR: or },
      select: {
        id: true,
        employeeId: true,
        email: true,
        emailNotifications: true,
        telegramNotifications: true,
        telegramChatId: true,
        digestEnabled: true,
      },
    });
  }

  /** Users holding a permission (e.g. admins for account approvals). */
  async userIdsWithPermission(code: string): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: {
        status: UserStatus.ACTIVE,
        role: { permissions: { some: { permission: { code } } } },
      },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  async processDelivery(deliveryId: string): Promise<void> {
    const delivery = await this.prisma.notificationDelivery.findUnique({
      where: { id: deliveryId },
      include: { notification: { include: { user: true, task: { select: { confidential: true } } } } },
    });
    if (!delivery || delivery.status === DeliveryStatus.SENT) return;
    const { notification } = delivery;
    const user = notification.user;
    try {
      if (delivery.channel === NotificationChannel.EMAIL) {
        if (!user.email) throw new Error('User has no email address');
        await this.email.send({
          to: user.email,
          subject: notification.title,
          text: notification.body,
          link: notification.link,
        });
      } else if (delivery.channel === NotificationChannel.TELEGRAM) {
        if (!user.telegramChatId) throw new Error('User has no linked Telegram chat');
        // Telegram is a third-party service: confidential task details stay inside Karban.
        const text = notification.task?.confidential
          ? 'اعلان جدیدی درباره‌ی یک وظیفه‌ی محرمانه دارید. جزئیات را در کاربان ببینید.'
          : `${notification.title}\n\n${notification.body}`;
        await this.telegram.sendMessage(user.telegramChatId, text, notification.link);
      }
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: DeliveryStatus.SENT, sentAt: new Date(), attempts: { increment: 1 }, error: null },
      });
    } catch (err) {
      const message = (err as Error).message?.slice(0, 1000) ?? 'unknown error';
      const updated = await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: DeliveryStatus.FAILED, attempts: { increment: 1 }, error: message },
      });
      this.logger.warn(`Delivery ${delivery.channel} ${delivery.id} failed: ${message}`);
      // PRD §93: failed deliveries are logged; in-app notification remains available.
      if (updated.attempts === 1 || this.queue.driver === 'inline') {
        await this.audit.log({
          action: AuditAction.NOTIFICATION_FAILURE,
          entityType: 'NotificationDelivery',
          entityId: delivery.id,
          metadata: { channel: delivery.channel, userId: user.id, error: message },
        });
      }
      if (this.queue.driver !== 'inline') throw err;
    }
  }

  /** Sends one email per user summarizing pending LOW-priority notifications (PRD §47). */
  async sendDigests(): Promise<number> {
    const pending = await this.prisma.notificationDelivery.findMany({
      where: {
        channel: NotificationChannel.EMAIL,
        status: DeliveryStatus.PENDING,
        notification: { priority: NotificationPriority.LOW },
      },
      include: { notification: { include: { user: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const byUser = new Map<string, typeof pending>();
    for (const d of pending) {
      const list = byUser.get(d.notification.userId) ?? [];
      list.push(d);
      byUser.set(d.notification.userId, list);
    }
    let sent = 0;
    for (const [, items] of byUser) {
      const user = items[0].notification.user;
      const ids = items.map((d) => d.id);
      const unread = items.filter((d) => !d.notification.readAt);
      if (!user.email || !user.digestEnabled || !unread.length) {
        await this.prisma.notificationDelivery.updateMany({
          where: { id: { in: ids } },
          data: { status: DeliveryStatus.SKIPPED },
        });
        continue;
      }
      const lines = unread
        .slice(0, 30)
        .map((d) => `• ${d.notification.title}`)
        .join('\n');
      const more = unread.length > 30 ? `\n… و ${unread.length - 30} مورد دیگر` : '';
      try {
        await this.email.send({
          to: user.email,
          subject: `خلاصه فعالیت‌های کاربان (${unread.length} مورد)`,
          text: `فعالیت‌های اخیر مرتبط با شما:\n\n${lines}${more}`,
          link: '/notifications',
          linkLabel: 'مشاهده اعلان‌ها',
        });
        await this.prisma.notificationDelivery.updateMany({
          where: { id: { in: ids } },
          data: { status: DeliveryStatus.DIGESTED, sentAt: new Date(), attempts: { increment: 1 } },
        });
        sent++;
      } catch (err) {
        await this.audit.log({
          action: AuditAction.NOTIFICATION_FAILURE,
          entityType: 'Digest',
          metadata: { userId: user.id, error: (err as Error).message },
        });
      }
    }
    return sent;
  }

  /* ------------------------------------------------------------ in-app API */

  async list(
    userId: string,
    q: { unreadOnly?: boolean; page: number; pageSize: number },
  ): Promise<Paginated<NotificationDto>> {
    const where: Prisma.NotificationWhereInput = { userId, readAt: q.unreadOnly ? null : undefined };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, items: rows.map(toNotificationDto) };
  }

  unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, id: string): Promise<void> {
    const res = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (!res.count) {
      const exists = await this.prisma.notification.count({ where: { id, userId } });
      if (!exists) throw Errors.notFound('اعلان');
    }
  }

  async markAllRead(userId: string): Promise<number> {
    const res = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return res.count;
  }

  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return {
      emailEnabled: u.emailNotifications,
      telegramEnabled: u.telegramNotifications,
      digestEnabled: u.digestEnabled,
    };
  }

  async updatePreferences(userId: string, patch: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        emailNotifications: patch.emailEnabled,
        telegramNotifications: patch.telegramEnabled,
        digestEnabled: patch.digestEnabled,
      },
    });
    return this.getPreferences(userId);
  }

  /* ------------------------------------------------------------ admin delivery log */

  async listDeliveries(q: {
    status?: DeliveryStatus;
    channel?: NotificationChannel;
    page: number;
    pageSize: number;
  }): Promise<Paginated<NotificationDeliveryDto>> {
    const where: Prisma.NotificationDeliveryWhereInput = { status: q.status, channel: q.channel };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.notificationDelivery.count({ where }),
      this.prisma.notificationDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { notification: { select: { id: true, type: true, title: true, userId: true } } },
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((d) => ({
        id: d.id,
        channel: d.channel,
        status: d.status,
        attempts: d.attempts,
        error: d.error,
        sentAt: d.sentAt?.toISOString() ?? null,
        createdAt: d.createdAt.toISOString(),
        notification: d.notification,
      })),
    };
  }

  async retryDelivery(id: string): Promise<void> {
    const d = await this.prisma.notificationDelivery.findUnique({ where: { id } });
    if (!d) throw Errors.notFound('ارسال اعلان');
    await this.prisma.notificationDelivery.update({
      where: { id },
      data: { status: DeliveryStatus.PENDING },
    });
    await this.queue.enqueue(JOB_DELIVER, { deliveryId: id });
  }
}

export function toNotificationDto(n: {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string;
  taskId: string | null;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}): NotificationDto {
  return {
    id: n.id,
    type: n.type,
    priority: n.priority,
    title: n.title,
    body: n.body,
    taskId: n.taskId,
    link: n.link,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}
