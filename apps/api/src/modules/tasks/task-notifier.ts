import { Injectable } from '@nestjs/common';
import { NotificationType, TaskPriority } from '@prisma/client';
import {
  BLOCKER_TYPE_LABELS,
  DELAY_REASON_LABELS,
  TASK_PRIORITY_LABELS,
  type BlockerType,
  type DelayReasonType,
} from '@karban/shared';
import { NotificationsService } from '../notifications/notifications.service';
import { InjectConfig } from '../../config/config.module';
import type { AppConfig } from '../../config/config';
import { formatJalali } from '../../common/utils/jalali';
import { taskCode } from './task.mapper';

export interface NotifiableTask {
  id: string;
  number: number;
  title: string;
  deadline: Date;
  priority: TaskPriority;
  primaryOwnerId: string;
  managerId: string;
  collaboratorIds?: string[];
}

interface Actor {
  employeeId: string | null;
  fullName: string;
}

/** Composes Persian notification texts for task events (PRD §43). */
@Injectable()
export class TaskNotifier {
  constructor(
    private readonly notifications: NotificationsService,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  private label(t: NotifiableTask) {
    return `«${t.title}» (${taskCode(t.number)})`;
  }

  private deadline(t: NotifiableTask) {
    return formatJalali(t.deadline, this.config.timeZone, { weekday: true, withTime: true });
  }

  assigned(t: NotifiableTask, actor: Actor) {
    return this.notifications.notify({
      employeeIds: [t.primaryOwnerId],
      type: NotificationType.TASK_ASSIGNED,
      title: `وظیفه جدید: ${t.title}`,
      body: `${actor.fullName} وظیفه ${this.label(t)} را به شما سپرد.\nمهلت: ${this.deadline(t)}\nاولویت: ${TASK_PRIORITY_LABELS[t.priority]}`,
      taskId: t.id,
      actorEmployeeId: actor.employeeId,
      priority: t.priority === 'URGENT' ? 'CRITICAL' : 'NORMAL',
    });
  }

  collaboratorsAdded(t: NotifiableTask, employeeIds: string[], actor: Actor) {
    if (!employeeIds.length) return;
    return this.notifications.notify({
      employeeIds,
      type: NotificationType.COLLABORATOR_ADDED,
      title: `همکاری در وظیفه: ${t.title}`,
      body: `${actor.fullName} شما را به‌عنوان همکار در وظیفه ${this.label(t)} اضافه کرد.\nمهلت: ${this.deadline(t)}`,
      taskId: t.id,
      actorEmployeeId: actor.employeeId,
    });
  }

  reassigned(t: NotifiableTask, previousOwnerId: string, actor: Actor, reason?: string) {
    return Promise.all([
      this.notifications.notify({
        employeeIds: [t.primaryOwnerId],
        type: NotificationType.TASK_REASSIGNED,
        title: `وظیفه به شما سپرده شد: ${t.title}`,
        body: `${actor.fullName} مسئولیت وظیفه ${this.label(t)} را به شما منتقل کرد.\nمهلت: ${this.deadline(t)}${reason ? `\nتوضیح: ${reason}` : ''}`,
        taskId: t.id,
        actorEmployeeId: actor.employeeId,
      }),
      this.notifications.notify({
        employeeIds: [previousOwnerId],
        type: NotificationType.TASK_REASSIGNED,
        title: `تغییر مسئول وظیفه: ${t.title}`,
        body: `مسئولیت وظیفه ${this.label(t)} توسط ${actor.fullName} به فرد دیگری منتقل شد.`,
        taskId: t.id,
        actorEmployeeId: actor.employeeId,
        priority: 'LOW',
      }),
    ]);
  }

  deadlineChanged(t: NotifiableTask, previous: Date, actor: Actor, note?: string) {
    return this.notifications.notify({
      employeeIds: [t.primaryOwnerId, ...(t.collaboratorIds ?? [])],
      type: NotificationType.DEADLINE_CHANGED,
      title: `تغییر مهلت: ${t.title}`,
      body: `مهلت وظیفه ${this.label(t)} از ${formatJalali(previous, this.config.timeZone)} به ${this.deadline(t)} تغییر کرد.${note ? `\nتوضیح: ${note}` : ''}`,
      taskId: t.id,
      actorEmployeeId: actor.employeeId,
    });
  }

  priorityChanged(t: NotifiableTask, previous: TaskPriority, actor: Actor) {
    const raised = t.priority === 'HIGH' || t.priority === 'URGENT';
    return this.notifications.notify({
      employeeIds: [t.primaryOwnerId],
      type: NotificationType.PRIORITY_CHANGED,
      title: `تغییر اولویت: ${t.title}`,
      body: `اولویت وظیفه ${this.label(t)} از «${TASK_PRIORITY_LABELS[previous]}» به «${TASK_PRIORITY_LABELS[t.priority]}» تغییر کرد.`,
      taskId: t.id,
      actorEmployeeId: actor.employeeId,
      priority: raised ? 'NORMAL' : 'LOW',
    });
  }

  blocked(
    t: NotifiableTask,
    blocker: { type: BlockerType; description: string; blockingEmployeeId?: string | null },
    blockingDepartmentManagerId: string | null,
    actor: Actor,
    confidential = false,
  ) {
    const text = `${BLOCKER_TYPE_LABELS[blocker.type]}: ${blocker.description}`;
    const jobs = [
      this.notifications.notify({
        employeeIds: [t.managerId],
        type: NotificationType.TASK_BLOCKED,
        title: `وظیفه مسدود شد: ${t.title}`,
        body: `${actor.fullName} وظیفه ${this.label(t)} را مسدود اعلام کرد.\nمانع — ${text}`,
        taskId: t.id,
        actorEmployeeId: actor.employeeId,
      }),
    ];
    const blockingParty = confidential
      ? []
      : [blocker.blockingEmployeeId, blockingDepartmentManagerId].filter(
          (id): id is string => !!id && id !== t.managerId,
        );
    if (blockingParty.length) {
      jobs.push(
        this.notifications.notify({
          employeeIds: blockingParty,
          type: NotificationType.TASK_BLOCKED,
          title: `یک وظیفه منتظر اقدام شماست`,
          body: `پیشرفت وظیفه ${this.label(t)} به اقدام شما یا واحد شما وابسته است.\nمانع — ${text}`,
          link: null,
          taskId: null,
          actorEmployeeId: actor.employeeId,
        }),
      );
    }
    return Promise.all(jobs);
  }

  completed(t: NotifiableTask, actor: Actor, requiresReview: boolean, lateDays: number, delayReason?: DelayReasonType) {
    return this.notifications.notify({
      employeeIds: [t.managerId],
      type: NotificationType.TASK_COMPLETED,
      title: `${requiresReview ? 'در انتظار تأیید' : 'تکمیل شد'}: ${t.title}`,
      body: `${actor.fullName} وظیفه ${this.label(t)} را تکمیل کرد.${
        lateDays > 0
          ? `\nتأخیر: ${lateDays} روز${delayReason ? ` — دلیل: ${DELAY_REASON_LABELS[delayReason]}` : ''}`
          : '\nدر مهلت مقرر انجام شد.'
      }${requiresReview ? '\nلطفاً نتیجه را بررسی و تأیید یا بازگشایی کنید.' : ''}`,
      taskId: t.id,
      actorEmployeeId: actor.employeeId,
    });
  }

  accepted(t: NotifiableTask, actor: Actor) {
    return this.notifications.notify({
      employeeIds: [t.primaryOwnerId],
      type: NotificationType.TASK_ACCEPTED,
      title: `تکمیل وظیفه تأیید شد: ${t.title}`,
      body: `${actor.fullName} تکمیل وظیفه ${this.label(t)} را تأیید کرد.`,
      taskId: t.id,
      actorEmployeeId: actor.employeeId,
    });
  }

  reopened(t: NotifiableTask, actor: Actor, reason: string) {
    return this.notifications.notify({
      employeeIds: [t.primaryOwnerId, ...(t.collaboratorIds ?? [])],
      type: NotificationType.TASK_REOPENED,
      title: `وظیفه بازگشایی شد: ${t.title}`,
      body: `${actor.fullName} وظیفه ${this.label(t)} را بازگشایی کرد.\nدلیل: ${reason}\nمهلت: ${this.deadline(t)}`,
      taskId: t.id,
      actorEmployeeId: actor.employeeId,
    });
  }

  cancelled(t: NotifiableTask, actor: Actor, reason: string) {
    return this.notifications.notify({
      employeeIds: [t.primaryOwnerId, ...(t.collaboratorIds ?? [])],
      type: NotificationType.TASK_CANCELLED,
      title: `وظیفه لغو شد: ${t.title}`,
      body: `${actor.fullName} وظیفه ${this.label(t)} را لغو کرد.\nدلیل: ${reason}`,
      taskId: t.id,
      actorEmployeeId: actor.employeeId,
    });
  }

  commented(t: NotifiableTask, actor: Actor, content: string, mentionIds: string[], watcherIds: string[]) {
    const excerpt = content.length > 280 ? `${content.slice(0, 280)}…` : content;
    const watchers = watcherIds.filter((id) => !mentionIds.includes(id));
    return Promise.all([
      this.notifications.notify({
        employeeIds: mentionIds,
        type: NotificationType.MENTIONED,
        title: `${actor.fullName} به شما اشاره کرد`,
        body: `در وظیفه ${this.label(t)}:\n«${excerpt}»`,
        taskId: t.id,
        actorEmployeeId: actor.employeeId,
      }),
      this.notifications.notify({
        employeeIds: watchers,
        type: NotificationType.COMMENT_ADDED,
        title: `نظر جدید: ${t.title}`,
        body: `${actor.fullName}: «${excerpt}»`,
        taskId: t.id,
        actorEmployeeId: actor.employeeId,
      }),
    ]);
  }
}
