import { Injectable } from '@nestjs/common';
import { CommentKind, Prisma, TaskEventType, TaskStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  toPersianDigits,
  type AttachmentDto,
  type CommentDto,
  type TaskDetail,
  type TimelineItem,
} from '@karban/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { SettingsService } from '../settings/settings.service';
import { RiskService } from '../risk/risk.service';
import type { AuthContext } from '../../common/auth-context';
import { Errors } from '../../common/errors';
import { employeeRefSelect, iso, toEmployeeRef } from '../../common/serializers';
import { recordHistory } from './task-history';
import { TaskNotifier } from './task-notifier';
import { assertOpen, TaskAccessService } from './task-access.service';
import { TasksService } from './tasks.service';
import type { CommentInputDto, CreateSubtaskDto, UpdateSubtaskDto } from './tasks.dto';

/** PRD §31: PDF, Word, Excel, images and ZIP (plus common office/text formats). */
const ALLOWED_TYPES: Record<string, string[]> = {
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xls': ['application/vnd.ms-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.ppt': ['application/vnd.ms-powerpoint'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.gif': ['image/gif'],
  '.webp': ['image/webp'],
  '.zip': ['application/zip', 'application/x-zip-compressed'],
  '.txt': ['text/plain'],
  '.csv': ['text/csv', 'application/vnd.ms-excel'],
};

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const commentInclude = {
  author: { select: employeeRefSelect },
  mentions: { include: { employee: { select: employeeRefSelect } } },
} satisfies Prisma.TaskCommentInclude;

function toCommentDto(c: Prisma.TaskCommentGetPayload<{ include: typeof commentInclude }>): CommentDto {
  return {
    id: c.id,
    content: c.content,
    kind: c.kind,
    author: toEmployeeRef(c.author),
    mentions: c.mentions.map((m) => toEmployeeRef(m.employee)!),
    createdAt: c.createdAt.toISOString(),
  };
}

/** Comments, timeline, attachments and subtasks of a task. */
@Injectable()
export class TaskActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TaskAccessService,
    private readonly tasks: TasksService,
    private readonly notifier: TaskNotifier,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly risk: RiskService,
  ) {}

  /* ------------------------------------------------------------ comments & timeline */

  async addComment(ctx: AuthContext, taskId: string, dto: CommentInputDto): Promise<CommentDto> {
    const task = await this.access.load(ctx, taskId, 'canComment');
    // Mentions are limited to people already involved, so a mention never leaks the task (PRD §58).
    const involved = new Set([task.primaryOwnerId, task.managerId, task.creatorId, ...task.collaboratorIds]);
    const mentionIds = [...new Set(dto.mentionIds ?? [])].filter((id) => id !== ctx.employeeId);
    const outsiders = mentionIds.filter((id) => !involved.has(id));
    if (outsiders.length) {
      throw Errors.validation(
        'فقط افراد مرتبط با این وظیفه را می‌توانید نام ببرید؛ ابتدا فرد را به‌عنوان همکار اضافه کنید.',
      );
    }
    const comment = await this.prisma.$transaction(async (tx) => {
      const c = await tx.taskComment.create({
        data: {
          taskId,
          authorId: ctx.employeeId,
          content: dto.content,
          kind: dto.kind ?? CommentKind.COMMENT,
          mentions: { create: mentionIds.map((employeeId) => ({ employeeId })) },
        },
        include: commentInclude,
      });
      await tx.task.update({ where: { id: taskId }, data: { lastActivityAt: new Date() } });
      await recordHistory(tx, taskId, ctx.employeeId, [
        { eventType: TaskEventType.COMMENT_ADDED, newValue: { commentId: c.id, kind: c.kind } },
      ]);
      return c;
    });
    const watchers = [...involved].filter((id) => id !== ctx.employeeId);
    await this.notifier.commented(
      await this.tasks.notifiable(taskId),
      { employeeId: ctx.employeeId, fullName: ctx.fullName },
      dto.content,
      mentionIds,
      watchers,
    );
    return toCommentDto(comment);
  }

  async listComments(ctx: AuthContext, taskId: string): Promise<CommentDto[]> {
    await this.access.load(ctx, taskId, 'canView');
    const rows = await this.prisma.taskComment.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
      include: commentInclude,
    });
    return rows.map(toCommentDto);
  }

  /** Chronological merge of history events and comments (PRD §30, §32). */
  async timeline(ctx: AuthContext, taskId: string): Promise<TimelineItem[]> {
    await this.access.load(ctx, taskId, 'canView');
    const [events, comments] = await Promise.all([
      this.prisma.taskHistory.findMany({
        where: { taskId, eventType: { not: TaskEventType.COMMENT_ADDED } },
        orderBy: { createdAt: 'asc' },
        include: { actor: { select: employeeRefSelect } },
      }),
      this.prisma.taskComment.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' }, include: commentInclude }),
    ]);
    const items: TimelineItem[] = [
      ...events.map((e) => ({
        id: e.id,
        type: 'event' as const,
        createdAt: e.createdAt.toISOString(),
        actor: toEmployeeRef(e.actor),
        eventType: e.eventType,
        field: e.field,
        oldValue: e.oldValue,
        newValue: e.newValue,
      })),
      ...comments.map((c) => ({
        id: c.id,
        type: 'comment' as const,
        createdAt: c.createdAt.toISOString(),
        actor: toEmployeeRef(c.author),
        comment: toCommentDto(c),
      })),
    ];
    return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /* ------------------------------------------------------------ attachments */

  async upload(ctx: AuthContext, taskId: string, file: UploadedFile | undefined): Promise<AttachmentDto> {
    if (!file) throw Errors.validation('فایلی ارسال نشده است.');
    await this.access.load(ctx, taskId, 'canWork');
    const settings = await this.settings.get();
    if (file.size > settings.attachmentMaxMb * 1024 * 1024) {
      throw Errors.validation(`حداکثر حجم مجاز هر فایل ${toPersianDigits(settings.attachmentMaxMb)} مگابایت است.`);
    }
    // Multer decodes multipart filenames as latin1; recover UTF-8 Persian names.
    const fileName = Buffer.from(file.originalname, 'latin1')
      .toString('utf8')
      .replace(/[\\/\0]/g, '_')
      .slice(0, 200);
    const ext = path.extname(fileName).toLowerCase();
    const allowed = ALLOWED_TYPES[ext];
    if (!allowed) {
      throw Errors.validation(
        'نوع فایل مجاز نیست. فایل‌های PDF، Word، Excel، PowerPoint، تصویر، ZIP، TXT و CSV پذیرفته می‌شوند.',
      );
    }
    const mimeType = allowed.includes(file.mimetype) ? file.mimetype : allowed[0];
    const storageKey = `tasks/${taskId}/${randomUUID()}${ext}`;
    await this.storage.put(storageKey, file.buffer, mimeType);
    const row = await this.prisma.$transaction(async (tx) => {
      const a = await tx.taskAttachment.create({
        data: { taskId, uploaderId: ctx.employeeId, fileName, mimeType, size: file.size, storageKey },
        include: { uploader: { select: employeeRefSelect } },
      });
      await tx.task.update({ where: { id: taskId }, data: { lastActivityAt: new Date() } });
      await recordHistory(tx, taskId, ctx.employeeId, [
        { eventType: TaskEventType.ATTACHMENT_ADDED, newValue: { attachmentId: a.id, fileName, size: file.size } },
      ]);
      return a;
    });
    return {
      id: row.id,
      fileName: row.fileName,
      mimeType: row.mimeType,
      size: row.size,
      uploader: toEmployeeRef(row.uploader),
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Secure download: always authorized through the parent task (PRD §102 "Secure File Access"). */
  async download(ctx: AuthContext, attachmentId: string) {
    const a = await this.prisma.taskAttachment.findUnique({ where: { id: attachmentId } });
    if (!a || a.deletedAt) throw Errors.notFound('فایل');
    await this.access.load(ctx, a.taskId, 'canView');
    const object = await this.storage.get(a.storageKey);
    return { ...object, fileName: a.fileName, mimeType: a.mimeType, size: a.size };
  }

  async removeAttachment(ctx: AuthContext, attachmentId: string): Promise<void> {
    const a = await this.prisma.taskAttachment.findUnique({ where: { id: attachmentId } });
    if (!a || a.deletedAt) throw Errors.notFound('فایل');
    const task = await this.access.load(ctx, a.taskId, 'canWork');
    if (a.uploaderId !== ctx.employeeId && !task.permissions.canManage) {
      throw Errors.forbidden('فقط بارگذارنده فایل یا مدیر وظیفه می‌تواند آن را حذف کند.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.taskAttachment.update({ where: { id: attachmentId }, data: { deletedAt: new Date() } });
      await recordHistory(tx, a.taskId, ctx.employeeId, [
        { eventType: TaskEventType.ATTACHMENT_REMOVED, oldValue: { attachmentId, fileName: a.fileName } },
      ]);
    });
    // History keeps the record; the object itself is removed from storage.
    await this.storage.remove(a.storageKey);
  }

  /* ------------------------------------------------------------ subtasks (one level, PRD §25) */

  async addSubtask(ctx: AuthContext, taskId: string, dto: CreateSubtaskDto): Promise<TaskDetail> {
    const task = await this.access.load(ctx, taskId, 'canWork');
    assertOpen(task);
    if (!task.permissions.canManage && task.primaryOwnerId !== ctx.employeeId) {
      throw Errors.forbidden('فقط مسئول اصلی یا مدیر وظیفه می‌تواند زیروظیفه تعریف کند.');
    }
    const ownerId = dto.ownerId ?? task.primaryOwnerId;
    if (!task.participantIds.includes(ownerId)) {
      throw Errors.validation('مسئول زیروظیفه باید از مسئولان یا همکاران همین وظیفه باشد.');
    }
    if (dto.deadline && dto.deadline > task.deadline) {
      throw Errors.validation('مهلت زیروظیفه نمی‌تواند بعد از مهلت وظیفه اصلی باشد.');
    }
    const count = await this.prisma.subtask.count({ where: { taskId } });
    if (count >= 50) throw Errors.validation('حداکثر ۵۰ زیروظیفه برای هر وظیفه مجاز است.');
    await this.prisma.$transaction(async (tx) => {
      const s = await tx.subtask.create({
        data: { taskId, title: dto.title, ownerId, deadline: dto.deadline, sortOrder: count },
      });
      await tx.task.update({ where: { id: taskId }, data: { lastActivityAt: new Date(), version: { increment: 1 } } });
      await recordHistory(tx, taskId, ctx.employeeId, [
        { eventType: TaskEventType.SUBTASK_ADDED, newValue: { subtaskId: s.id, title: s.title, ownerId } },
      ]);
    });
    return this.tasks.get(ctx, taskId);
  }

  async updateSubtask(ctx: AuthContext, subtaskId: string, dto: UpdateSubtaskDto): Promise<TaskDetail> {
    const sub = await this.prisma.subtask.findUnique({ where: { id: subtaskId } });
    if (!sub) throw Errors.notFound('زیروظیفه');
    const task = await this.access.load(ctx, sub.taskId, 'canWork');
    assertOpen(task);
    const structural =
      dto.title !== undefined || dto.ownerId !== undefined || dto.deadline !== undefined || dto.sortOrder !== undefined;
    const isLead = task.permissions.canManage || task.primaryOwnerId === ctx.employeeId;
    if (structural && !isLead) throw Errors.forbidden('فقط مسئول اصلی یا مدیر وظیفه می‌تواند زیروظیفه را ویرایش کند.');
    if (!isLead && sub.ownerId !== ctx.employeeId) {
      throw Errors.forbidden('فقط مسئول این زیروظیفه می‌تواند وضعیت آن را تغییر دهد.');
    }
    if (dto.ownerId && !task.participantIds.includes(dto.ownerId)) {
      throw Errors.validation('مسئول زیروظیفه باید از مسئولان یا همکاران همین وظیفه باشد.');
    }
    if (dto.deadline && dto.deadline > task.deadline) {
      throw Errors.validation('مهلت زیروظیفه نمی‌تواند بعد از مهلت وظیفه اصلی باشد.');
    }
    const now = new Date();
    let status = dto.status;
    let progress = dto.progress;
    if (status === TaskStatus.COMPLETED) progress = 100;
    else if (progress === 100 && status === undefined) status = TaskStatus.COMPLETED;
    else if (progress !== undefined && progress > 0 && sub.status === TaskStatus.NOT_STARTED && status === undefined) {
      status = TaskStatus.IN_PROGRESS;
    }
    const changes = Object.fromEntries(
      Object.entries({
        title: dto.title,
        ownerId: dto.ownerId,
        deadline: dto.deadline,
        status,
        progress,
        sortOrder: dto.sortOrder,
      }).filter(([, v]) => v !== undefined),
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.subtask.update({
        where: { id: subtaskId },
        data: {
          ...changes,
          completedAt: status === TaskStatus.COMPLETED ? now : status ? null : undefined,
        },
      });
      const progressSignal = status !== undefined || progress !== undefined;
      await tx.task.update({
        where: { id: sub.taskId },
        data: { lastActivityAt: now, lastProgressAt: progressSignal ? now : undefined, version: { increment: 1 } },
      });
      await recordHistory(tx, sub.taskId, ctx.employeeId, [
        {
          eventType: TaskEventType.SUBTASK_UPDATED,
          field: Object.keys(changes).join(','),
          oldValue: { subtaskId, title: sub.title, status: sub.status, progress: sub.progress },
          newValue: { subtaskId, ...changes, deadline: iso(dto.deadline ?? null) ?? undefined },
        },
      ]);
    });
    await this.risk.refresh([sub.taskId]).catch(() => undefined);
    return this.tasks.get(ctx, sub.taskId);
  }

  async removeSubtask(ctx: AuthContext, subtaskId: string): Promise<TaskDetail> {
    const sub = await this.prisma.subtask.findUnique({ where: { id: subtaskId } });
    if (!sub) throw Errors.notFound('زیروظیفه');
    const task = await this.access.load(ctx, sub.taskId, 'canWork');
    assertOpen(task);
    if (!task.permissions.canManage && task.primaryOwnerId !== ctx.employeeId) {
      throw Errors.forbidden('فقط مسئول اصلی یا مدیر وظیفه می‌تواند زیروظیفه را حذف کند.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.subtask.delete({ where: { id: subtaskId } });
      await tx.task.update({
        where: { id: sub.taskId },
        data: { lastActivityAt: new Date(), version: { increment: 1 } },
      });
      await recordHistory(tx, sub.taskId, ctx.employeeId, [
        { eventType: TaskEventType.SUBTASK_REMOVED, oldValue: { subtaskId, title: sub.title } },
      ]);
    });
    return this.tasks.get(ctx, sub.taskId);
  }
}
