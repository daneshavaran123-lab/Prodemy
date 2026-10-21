import { Injectable } from '@nestjs/common';
import {
  AssignmentType,
  AuditAction,
  BlockerStatus,
  CommentKind,
  EmploymentStatus,
  Prisma,
  ReviewStatus,
  RiskLevel,
  TaskEventType,
  TaskPriority,
  TaskStatus,
  UserStatus,
} from '@prisma/client';
import {
  OPEN_TASK_STATUSES,
  addDaysToKey,
  diffDateKeys,
  delayDays,
  normalizePersian,
  startOfZonedDay,
  zonedDateKey,
  type Paginated,
  type TaskDetail,
  type TaskSummary,
} from '@karban/shared';
import { PrismaService, type Db } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RiskService } from '../risk/risk.service';
import { InjectConfig } from '../../config/config.module';
import type { AppConfig } from '../../config/config';
import type { AuthContext } from '../../common/auth-context';
import { Errors } from '../../common/errors';
import { TaskPolicy } from '../access/access-policy';
import { recordHistory, type HistoryEntry } from './task-history';
import { TaskNotifier, type NotifiableTask } from './task-notifier';
import { assertOpen, TaskAccessService, type LoadedTask } from './task-access.service';
import {
  accessFacts,
  needsDelayReason,
  taskDetailInclude,
  taskSummaryInclude,
  toTaskDetail,
  toTaskSummary,
} from './task.mapper';
import { RecurrenceService } from '../recurrence/recurrence.service';
import type {
  BlockerInputDto,
  BulkManagerDto,
  ChangeStatusDto,
  CollaboratorsDto,
  CompleteTaskDto,
  CreateTaskDto,
  DelayReasonInputDto,
  ListTasksQuery,
  ProgressDto,
  ReasonDto,
  ReassignDto,
  ReopenDto,
  UpdateTaskDto,
} from './tasks.dto';

const OPEN = OPEN_TASK_STATUSES as TaskStatus[];
const CLOSED: TaskStatus[] = [TaskStatus.COMPLETED, TaskStatus.CANCELLED];

/** Inputs shared by manual creation and recurrence instantiation. */
export interface TaskCreationInput {
  title: string;
  description: string;
  creatorId: string;
  departmentId: string;
  primaryOwnerId: string;
  managerId: string;
  collaboratorIds: string[];
  startDate: Date;
  deadline: Date;
  priority: TaskPriority;
  status: TaskStatus;
  category?: string | null;
  tags: string[];
  projectId?: string | null;
  estimatedEffortHours?: number | null;
  confidential: boolean;
  requiresReview: boolean;
  recurrenceId?: string | null;
  recurrenceOccurrence?: string | null;
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TaskAccessService,
    private readonly notifier: TaskNotifier,
    private readonly audit: AuditService,
    private readonly risk: RiskService,
    private readonly recurrence: RecurrenceService,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  private actor(ctx: AuthContext) {
    return { employeeId: ctx.employeeId, fullName: ctx.fullName };
  }

  /* ================================================================ queries */

  async list(ctx: AuthContext, q: ListTasksQuery): Promise<Paginated<TaskSummary>> {
    const where = this.buildWhere(ctx, q);
    if (q.delayReasonMissing) {
      (where.AND as Prisma.TaskWhereInput[]).push({ id: { in: await this.delayReasonMissingIds() } });
    }
    const orderBy = this.buildOrder(q);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.task.count({ where }),
      this.prisma.task.findMany({
        where,
        orderBy,
        include: taskSummaryInclude,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    const now = new Date();
    return { total, page: q.page, pageSize: q.pageSize, items: rows.map((r) => toTaskSummary(r, now)) };
  }

  /** Visibility filter AND user-chosen filters (PRD §39–40). */
  buildWhere(ctx: AuthContext, q: Partial<ListTasksQuery>, now = new Date()): Prisma.TaskWhereInput {
    const and: Prisma.TaskWhereInput[] = [TaskPolicy.visibleWhere(ctx)];
    switch (q.scope) {
      case 'mine':
        and.push({ assignments: { some: { employeeId: ctx.employeeId } } });
        break;
      case 'owned':
        and.push({ primaryOwnerId: ctx.employeeId });
        break;
      case 'collaborating':
        and.push({ assignments: { some: { employeeId: ctx.employeeId, type: AssignmentType.COLLABORATOR } } });
        break;
      case 'managed':
        and.push({ managerId: ctx.employeeId });
        break;
      case 'created':
        and.push({ creatorId: ctx.employeeId });
        break;
    }
    if (q.status?.length) {
      const statuses = new Set<TaskStatus>();
      for (const s of q.status) {
        if (s === 'open') OPEN.forEach((x) => statuses.add(x));
        else if (s === 'closed') CLOSED.forEach((x) => statuses.add(x));
        else if ((Object.values(TaskStatus) as string[]).includes(s)) statuses.add(s as TaskStatus);
      }
      and.push({ status: { in: [...statuses] } });
    }
    if (q.priority?.length) and.push({ priority: { in: q.priority } });
    if (q.risk?.length) and.push({ riskLevel: { in: q.risk }, status: { in: OPEN } });
    if (q.departmentId) and.push({ departmentId: q.departmentId });
    if (q.ownerId) and.push({ primaryOwnerId: q.ownerId });
    if (q.creatorId) and.push({ creatorId: q.creatorId });
    if (q.managerId) and.push({ managerId: q.managerId });
    if (q.projectId) and.push({ projectId: q.projectId });
    if (q.teamId) and.push({ primaryOwner: { teamId: q.teamId } });
    if (q.tag) and.push({ tags: { has: q.tag } });
    if (q.category) and.push({ category: q.category });
    if (q.overdue === true) and.push({ status: { in: OPEN }, deadline: { lt: now } });
    if (q.overdue === false) and.push({ NOT: { status: { in: OPEN }, deadline: { lt: now } } });
    if (q.blocked === true) {
      and.push({
        status: { in: OPEN },
        OR: [{ status: TaskStatus.BLOCKED }, { blockers: { some: { status: BlockerStatus.OPEN } } }],
      });
    }
    if (q.pendingReview) and.push({ status: TaskStatus.COMPLETED, reviewStatus: ReviewStatus.PENDING });
    if (q.deadlineFrom || q.deadlineTo) and.push({ deadline: { gte: q.deadlineFrom, lte: q.deadlineTo } });
    if (q.dueWithinDays !== undefined) {
      and.push({
        status: { in: OPEN },
        deadline: { gte: now, lte: new Date(now.getTime() + q.dueWithinDays * 86_400_000) },
      });
    }
    if (q.q) {
      const term = normalizePersian(q.q);
      const codeMatch = /^(?:kb-?)?(\d+)$/i.exec(term);
      and.push({
        OR: [
          ...(codeMatch ? [{ number: Number(codeMatch[1]) }] : []),
          { title: { contains: term, mode: 'insensitive' } },
          { description: { contains: term, mode: 'insensitive' } },
          { tags: { has: term } },
          { category: { contains: term, mode: 'insensitive' } },
          { project: { name: { contains: term, mode: 'insensitive' } } },
          { primaryOwner: { fullName: { contains: term, mode: 'insensitive' } } },
          { assignments: { some: { employee: { fullName: { contains: term, mode: 'insensitive' } } } } },
        ],
      });
    }
    return { AND: and };
  }

  private buildOrder(q: ListTasksQuery): Prisma.TaskOrderByWithRelationInput[] {
    const dir = q.order ?? (q.sort === 'priority' || q.sort === 'risk' || q.sort === 'updatedAt' ? 'desc' : 'asc');
    switch (q.sort) {
      case 'priority':
        return [{ priority: dir }, { deadline: 'asc' }];
      case 'risk':
        return [{ riskScore: { sort: dir, nulls: 'last' } }, { deadline: 'asc' }];
      case 'updatedAt':
        return [{ lastActivityAt: dir }];
      case 'createdAt':
        return [{ createdAt: dir }];
      case 'progress':
        return [{ progress: dir }, { deadline: 'asc' }];
      case 'number':
        return [{ number: dir }];
      case 'deadline':
      default:
        return [{ deadline: dir }, { priority: 'desc' }];
    }
  }

  async get(ctx: AuthContext, id: string): Promise<TaskDetail> {
    const row = await this.prisma.task.findUnique({ where: { id }, include: taskDetailInclude });
    if (!row) throw Errors.notFound('وظیفه');
    const permissions = TaskPolicy.permissions(ctx, accessFacts(row));
    if (!permissions.canView) throw Errors.forbidden('شما به این وظیفه دسترسی ندارید.');
    return toTaskDetail(row, permissions);
  }

  /* ================================================================ create */

  async create(ctx: AuthContext, dto: CreateTaskDto): Promise<TaskDetail> {
    const owner = await this.activeEmployee(dto.primaryOwnerId, 'مسئول اصلی');
    if (!TaskPolicy.canAssignTo(ctx, owner)) {
      throw Errors.forbidden('شما مجاز به تخصیص وظیفه به این فرد نیستید.');
    }
    const selfOnly = ctx.scopes.taskManage === 'self';

    // Manager: employees' personal tasks are supervised by their own manager (PRD §19).
    let managerId: string;
    if (selfOnly) managerId = owner.managerId ?? ctx.employeeId;
    else if (dto.managerId) managerId = dto.managerId;
    else if (owner.id === ctx.employeeId) managerId = owner.managerId ?? ctx.employeeId;
    else managerId = ctx.employeeId;
    if (managerId !== ctx.employeeId) await this.activeEmployee(managerId, 'مدیر وظیفه');

    // Department context: the owner's department unless an authorized manager says otherwise.
    const departmentId = dto.departmentId ?? owner.departmentId;
    if (
      departmentId !== owner.departmentId &&
      ctx.scopes.taskManage !== 'all' &&
      !ctx.departmentScopeIds.includes(departmentId)
    ) {
      throw Errors.forbidden('شما مجاز به ایجاد وظیفه در این دپارتمان نیستید.');
    }
    const department = await this.prisma.department.findUnique({ where: { id: departmentId } });
    if (!department || department.status !== 'ACTIVE') throw Errors.validation('دپارتمان نامعتبر است.');

    const now = new Date();
    const startDate = dto.startDate ?? now;
    this.assertDates(startDate, dto.deadline, now);
    const collaboratorIds = await this.validateCollaborators(dto.collaboratorIds ?? [], owner.id);
    if (dto.projectId && !(await this.prisma.project.count({ where: { id: dto.projectId } }))) {
      throw Errors.validation('پروژه یافت نشد.');
    }

    const input: TaskCreationInput = {
      title: dto.title,
      description: dto.description,
      creatorId: ctx.employeeId,
      departmentId,
      primaryOwnerId: owner.id,
      managerId,
      collaboratorIds,
      startDate,
      deadline: dto.deadline,
      priority: dto.priority ?? TaskPriority.NORMAL,
      status: dto.status ?? TaskStatus.NOT_STARTED,
      category: dto.category,
      tags: normalizeTags(dto.tags),
      projectId: dto.projectId,
      estimatedEffortHours: dto.estimatedEffortHours,
      confidential: dto.confidential ?? department.confidential,
      requiresReview: dto.requiresReview ?? false,
    };

    const task = await this.prisma.$transaction(async (tx) => {
      if (dto.recurrence) {
        const tz = this.config.timeZone;
        const startKey = zonedDateKey(startDate, tz);
        const rule = await this.recurrence.createRule(tx, {
          ...input,
          frequency: dto.recurrence.frequency,
          interval: dto.recurrence.interval ?? 1,
          weekdays: dto.recurrence.weekdays ?? [],
          dayOfMonth: dto.recurrence.dayOfMonth ?? null,
          durationDays: Math.max(0, diffDateKeys(startKey, zonedDateKey(dto.deadline, tz))),
          startDate: startKey,
          endDate: dto.recurrence.endDate ?? null,
        });
        input.recurrenceId = rule.id;
        input.recurrenceOccurrence = startKey;
      }
      return this.createWithin(tx, input, ctx.employeeId);
    });

    await this.risk.refresh([task.id]).catch(() => undefined);
    const notifiable = { ...task, collaboratorIds };
    if (owner.id !== ctx.employeeId) await this.notifier.assigned(notifiable, this.actor(ctx));
    await this.notifier.collaboratorsAdded(notifiable, collaboratorIds, this.actor(ctx));
    return this.get(ctx, task.id);
  }

  /** Inserts a task with assignments and creation history inside a transaction. */
  async createWithin(tx: Db, input: TaskCreationInput, actorId: string | null) {
    const task = await tx.task.create({
      data: {
        title: input.title,
        description: input.description,
        creatorId: input.creatorId,
        departmentId: input.departmentId,
        primaryOwnerId: input.primaryOwnerId,
        managerId: input.managerId,
        startDate: input.startDate,
        deadline: input.deadline,
        priority: input.priority,
        status: input.status,
        category: input.category ?? null,
        tags: input.tags,
        projectId: input.projectId ?? null,
        estimatedEffortHours: input.estimatedEffortHours ?? null,
        confidential: input.confidential,
        requiresReview: input.requiresReview,
        recurrenceId: input.recurrenceId ?? null,
        recurrenceOccurrence: input.recurrenceOccurrence ?? null,
        assignments: {
          create: [
            { employeeId: input.primaryOwnerId, type: AssignmentType.PRIMARY, assignedById: actorId },
            ...input.collaboratorIds.map((employeeId) => ({
              employeeId,
              type: AssignmentType.COLLABORATOR,
              assignedById: actorId,
            })),
          ],
        },
      },
    });
    await recordHistory(tx, task.id, actorId, [
      {
        eventType: TaskEventType.CREATED,
        newValue: {
          title: task.title,
          deadline: task.deadline.toISOString(),
          priority: task.priority,
          status: task.status,
          recurrenceOccurrence: task.recurrenceOccurrence,
        },
      },
      {
        eventType: TaskEventType.ASSIGNED,
        field: 'primaryOwnerId',
        newValue: { primaryOwnerId: input.primaryOwnerId, collaboratorIds: input.collaboratorIds },
      },
    ]);
    return task;
  }

  /* ================================================================ update */

  async update(ctx: AuthContext, id: string, dto: UpdateTaskDto): Promise<TaskDetail> {
    const current = await this.prisma.task.findUnique({ where: { id } });
    if (!current) throw Errors.notFound('وظیفه');
    await this.access.load(ctx, id, 'canEdit');
    if (current.version !== dto.version) throw Errors.staleVersion();

    const data: Prisma.TaskUncheckedUpdateManyInput = {};
    const history: HistoryEntry[] = [];
    const changed = (k: keyof typeof current, v: unknown) =>
      v !== undefined &&
      JSON.stringify(v instanceof Date ? v.toISOString() : v) !==
        JSON.stringify(current[k] instanceof Date ? (current[k] as Date).toISOString() : current[k]);

    for (const field of [
      'title',
      'description',
      'category',
      'estimatedEffortHours',
      'confidential',
      'requiresReview',
    ] as const) {
      if (changed(field, dto[field])) {
        (data as any)[field] = dto[field];
        history.push({
          eventType: TaskEventType.DETAILS_CHANGED,
          field,
          oldValue: field === 'description' ? null : current[field],
          newValue: field === 'description' ? null : dto[field],
        });
      }
    }
    if (dto.tags !== undefined) {
      const tags = normalizeTags(dto.tags);
      if (JSON.stringify(tags) !== JSON.stringify(current.tags)) {
        data.tags = tags;
        history.push({
          eventType: TaskEventType.DETAILS_CHANGED,
          field: 'tags',
          oldValue: current.tags,
          newValue: tags,
        });
      }
    }
    if (dto.projectId !== undefined && dto.projectId !== current.projectId) {
      if (dto.projectId && !(await this.prisma.project.count({ where: { id: dto.projectId } }))) {
        throw Errors.validation('پروژه یافت نشد.');
      }
      data.projectId = dto.projectId;
      history.push({
        eventType: TaskEventType.DETAILS_CHANGED,
        field: 'projectId',
        oldValue: current.projectId,
        newValue: dto.projectId,
      });
    }
    const startDate = dto.startDate ?? current.startDate;
    const deadline = dto.deadline ?? current.deadline;
    if (changed('startDate', dto.startDate)) {
      data.startDate = dto.startDate;
      history.push({
        eventType: TaskEventType.DETAILS_CHANGED,
        field: 'startDate',
        oldValue: current.startDate,
        newValue: dto.startDate,
      });
    }
    const deadlineChanged = changed('deadline', dto.deadline);
    if (deadlineChanged || changed('startDate', dto.startDate)) {
      if (deadline.getTime() < startDate.getTime()) {
        throw Errors.validation('مهلت انجام نمی‌تواند قبل از تاریخ شروع باشد.');
      }
    }
    if (deadlineChanged) {
      data.deadline = deadline;
      if (deadline > new Date()) data.overdueAt = null;
      history.push({
        eventType: TaskEventType.DEADLINE_CHANGED,
        field: 'deadline',
        oldValue: current.deadline.toISOString(),
        newValue: { deadline: deadline.toISOString(), note: dto.changeNote ?? null },
      });
    }
    const priorityChanged = dto.priority !== undefined && dto.priority !== current.priority;
    if (priorityChanged) {
      data.priority = dto.priority;
      history.push({
        eventType: TaskEventType.PRIORITY_CHANGED,
        field: 'priority',
        oldValue: current.priority,
        newValue: dto.priority,
      });
    }
    if (dto.managerId !== undefined && dto.managerId !== current.managerId) {
      if (ctx.scopes.taskManage === 'self') throw Errors.forbidden('تغییر مدیر وظیفه فقط توسط مدیران امکان‌پذیر است.');
      await this.activeEmployee(dto.managerId, 'مدیر وظیفه');
      data.managerId = dto.managerId;
      history.push({
        eventType: TaskEventType.MANAGER_CHANGED,
        field: 'managerId',
        oldValue: current.managerId,
        newValue: dto.managerId,
      });
    }
    if (dto.departmentId !== undefined && dto.departmentId !== current.departmentId) {
      if (ctx.scopes.taskManage !== 'all' && !ctx.departmentScopeIds.includes(dto.departmentId)) {
        throw Errors.forbidden('شما مجاز به انتقال وظیفه به این دپارتمان نیستید.');
      }
      data.departmentId = dto.departmentId;
      history.push({
        eventType: TaskEventType.DETAILS_CHANGED,
        field: 'departmentId',
        oldValue: current.departmentId,
        newValue: dto.departmentId,
      });
    }
    if (!history.length) return this.get(ctx, id);

    await this.prisma.$transaction(async (tx) => {
      await this.lockedUpdate(tx, id, dto.version, { ...data, lastActivityAt: new Date() });
      await recordHistory(tx, id, ctx.employeeId, history);
    });
    await this.risk.refresh([id]).catch(() => undefined);

    const after = await this.notifiable(id);
    if (deadlineChanged) await this.notifier.deadlineChanged(after, current.deadline, this.actor(ctx), dto.changeNote);
    if (priorityChanged) await this.notifier.priorityChanged(after, current.priority, this.actor(ctx));
    return this.get(ctx, id);
  }

  /* ================================================================ lifecycle */

  async changeStatus(ctx: AuthContext, id: string, dto: ChangeStatusDto): Promise<TaskDetail> {
    const task = await this.access.load(ctx, id, 'canWork');
    assertOpen(task);
    this.checkVersion(task, dto.version);
    if (dto.status === task.status && dto.status !== TaskStatus.BLOCKED) return this.get(ctx, id);

    const openBlockers = await this.prisma.blocker.count({ where: { taskId: id, status: BlockerStatus.OPEN } });
    if (dto.status === TaskStatus.BLOCKED && !dto.blocker && !openBlockers) {
      throw Errors.validation('برای مسدود کردن وظیفه، دلیل و توضیح مانع را ثبت کنید.', { code: 'BLOCKER_REQUIRED' });
    }
    const blockerResult = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const history: HistoryEntry[] = [];
      let created: { blockingDepartmentManagerId: string | null } | null = null;
      if (dto.status !== task.status) {
        history.push({
          eventType: TaskEventType.STATUS_CHANGED,
          field: 'status',
          oldValue: task.status,
          newValue: dto.status,
        });
      }
      if (dto.status === TaskStatus.BLOCKED && dto.blocker) {
        created = await this.insertBlocker(tx, id, ctx.employeeId, dto.blocker);
        history.push({
          eventType: TaskEventType.BLOCKER_ADDED,
          newValue: { type: dto.blocker.type, description: dto.blocker.description },
        });
      }
      if (task.status === TaskStatus.BLOCKED && dto.status !== TaskStatus.BLOCKED && openBlockers) {
        await tx.blocker.updateMany({
          where: { taskId: id, status: BlockerStatus.OPEN },
          data: {
            status: BlockerStatus.RESOLVED,
            resolvedAt: now,
            resolvedById: ctx.employeeId,
            resolutionNote: dto.note,
          },
        });
        history.push({ eventType: TaskEventType.BLOCKER_RESOLVED, newValue: { count: openBlockers } });
      }
      await this.lockedUpdate(tx, id, task.version, { status: dto.status, lastActivityAt: now, lastProgressAt: now });
      await recordHistory(tx, id, ctx.employeeId, history);
      if (dto.note) {
        await this.insertComment(
          tx,
          id,
          ctx.employeeId,
          dto.note,
          dto.status === TaskStatus.BLOCKED ? CommentKind.BLOCKER_NOTE : CommentKind.COMMENT,
        );
      }
      return created;
    });
    await this.risk.refresh([id]).catch(() => undefined);
    if (dto.blocker && blockerResult) {
      // Confidential tasks never reveal their title to people outside the task.
      await this.notifier.blocked(
        await this.notifiable(id),
        dto.blocker,
        task.confidential ? null : blockerResult.blockingDepartmentManagerId,
        this.actor(ctx),
        task.confidential,
      );
    }
    return this.get(ctx, id);
  }

  async updateProgress(ctx: AuthContext, id: string, dto: ProgressDto): Promise<TaskDetail> {
    const task = await this.access.load(ctx, id, 'canWork');
    assertOpen(task);
    this.checkVersion(task, dto.version);
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const history: HistoryEntry[] = [];
      const data: Prisma.TaskUncheckedUpdateManyInput = {
        progress: dto.progress,
        lastActivityAt: now,
        lastProgressAt: now,
      };
      if (dto.progress !== task.progress) {
        history.push({
          eventType: TaskEventType.PROGRESS_CHANGED,
          field: 'progress',
          oldValue: task.progress,
          newValue: dto.progress,
        });
      }
      if (task.status === TaskStatus.NOT_STARTED && dto.progress > 0) {
        data.status = TaskStatus.IN_PROGRESS;
        history.push({
          eventType: TaskEventType.STATUS_CHANGED,
          field: 'status',
          oldValue: task.status,
          newValue: TaskStatus.IN_PROGRESS,
        });
      }
      await this.lockedUpdate(tx, id, task.version, data);
      await recordHistory(tx, id, ctx.employeeId, history);
      if (dto.comment) await this.insertComment(tx, id, ctx.employeeId, dto.comment, CommentKind.COMMENT);
    });
    await this.risk.refresh([id]).catch(() => undefined);
    return this.get(ctx, id);
  }

  async complete(ctx: AuthContext, id: string, dto: CompleteTaskDto): Promise<TaskDetail> {
    const task = await this.access.load(ctx, id, 'canComplete');
    this.checkVersion(task, dto.version);
    const now = new Date();
    const reasons = await this.prisma.delayReason.findMany({ where: { taskId: id }, select: { deadlineAt: true } });
    const late = now > task.deadline;
    if (late && !dto.delayReason && needsDelayReason({ ...task, status: TaskStatus.IN_PROGRESS }, reasons, now)) {
      throw Errors.validation('این وظیفه با تأخیر تکمیل می‌شود؛ ثبت دلیل تأخیر الزامی است.', {
        code: 'DELAY_REASON_REQUIRED',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      const history: HistoryEntry[] = [];
      if (late && dto.delayReason) {
        await this.insertDelayReason(tx, id, ctx.employeeId, task.deadline, dto.delayReason);
        history.push({ eventType: TaskEventType.DELAY_REASON_ADDED, newValue: dto.delayReason });
      }
      if (task.progress !== 100) {
        history.push({
          eventType: TaskEventType.PROGRESS_CHANGED,
          field: 'progress',
          oldValue: task.progress,
          newValue: 100,
        });
      }
      history.push({
        eventType: TaskEventType.COMPLETED,
        field: 'status',
        oldValue: task.status,
        newValue: { status: TaskStatus.COMPLETED, delayDays: delayDays(task.deadline, now) },
      });
      await tx.blocker.updateMany({
        where: { taskId: id, status: BlockerStatus.OPEN },
        data: { status: BlockerStatus.RESOLVED, resolvedAt: now, resolvedById: ctx.employeeId },
      });
      await this.lockedUpdate(tx, id, task.version, {
        status: TaskStatus.COMPLETED,
        progress: 100,
        completedAt: now,
        completedById: ctx.employeeId,
        reviewStatus: task.requiresReview ? ReviewStatus.PENDING : ReviewStatus.NONE,
        lastActivityAt: now,
        lastProgressAt: now,
        riskLevel: null,
        riskScore: null,
        riskFactors: Prisma.JsonNull,
      });
      await recordHistory(tx, id, ctx.employeeId, history);
      if (dto.note) await this.insertComment(tx, id, ctx.employeeId, dto.note, CommentKind.COMMENT);
    });
    const t = await this.notifiable(id);
    if (task.managerId !== ctx.employeeId) {
      await this.notifier.completed(
        t,
        this.actor(ctx),
        task.requiresReview,
        delayDays(task.deadline, now),
        dto.delayReason?.reasonType,
      );
    }
    return this.get(ctx, id);
  }

  async accept(ctx: AuthContext, id: string): Promise<TaskDetail> {
    const task = await this.access.load(ctx, id, 'canReview');
    await this.prisma.$transaction(async (tx) => {
      await this.lockedUpdate(tx, id, task.version, {
        reviewStatus: ReviewStatus.ACCEPTED,
        lastActivityAt: new Date(),
      });
      await recordHistory(tx, id, ctx.employeeId, [
        {
          eventType: TaskEventType.ACCEPTED,
          field: 'reviewStatus',
          oldValue: ReviewStatus.PENDING,
          newValue: ReviewStatus.ACCEPTED,
        },
      ]);
    });
    await this.notifier.accepted(await this.notifiable(id), this.actor(ctx));
    return this.get(ctx, id);
  }

  async reopen(ctx: AuthContext, id: string, dto: ReopenDto): Promise<TaskDetail> {
    const task = await this.access.load(ctx, id, 'canReopen');
    this.checkVersion(task, dto.version);
    const now = new Date();
    if (dto.deadline && dto.deadline < startOfZonedDay(now, this.config.timeZone)) {
      throw Errors.validation('مهلت جدید نمی‌تواند در گذشته باشد.');
    }
    await this.prisma.$transaction(async (tx) => {
      const history: HistoryEntry[] = [
        {
          eventType: TaskEventType.REOPENED,
          field: 'status',
          oldValue: task.status,
          newValue: { status: TaskStatus.IN_PROGRESS, reason: dto.reason },
        },
      ];
      const data: Prisma.TaskUncheckedUpdateManyInput = {
        status: TaskStatus.IN_PROGRESS,
        completedAt: null,
        completedById: null,
        cancelledAt: null,
        reviewStatus: ReviewStatus.NONE,
        lastActivityAt: now,
        lastProgressAt: now,
      };
      if (dto.deadline && dto.deadline.getTime() !== task.deadline.getTime()) {
        data.deadline = dto.deadline;
        data.overdueAt = null;
        history.push({
          eventType: TaskEventType.DEADLINE_CHANGED,
          field: 'deadline',
          oldValue: task.deadline.toISOString(),
          newValue: { deadline: dto.deadline.toISOString(), note: dto.reason },
        });
      }
      await this.lockedUpdate(tx, id, task.version, data);
      await recordHistory(tx, id, ctx.employeeId, history);
      await this.insertComment(tx, id, ctx.employeeId, `بازگشایی وظیفه: ${dto.reason}`, CommentKind.DECISION);
    });
    await this.risk.refresh([id]).catch(() => undefined);
    await this.notifier.reopened(await this.notifiable(id), this.actor(ctx), dto.reason);
    return this.get(ctx, id);
  }

  async cancel(ctx: AuthContext, id: string, dto: ReasonDto): Promise<TaskDetail> {
    const task = await this.access.load(ctx, id, 'canCancel');
    this.checkVersion(task, dto.version);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.blocker.updateMany({
        where: { taskId: id, status: BlockerStatus.OPEN },
        data: {
          status: BlockerStatus.RESOLVED,
          resolvedAt: now,
          resolvedById: ctx.employeeId,
          resolutionNote: 'لغو وظیفه',
        },
      });
      await this.lockedUpdate(tx, id, task.version, {
        status: TaskStatus.CANCELLED,
        cancelledAt: now,
        lastActivityAt: now,
        riskLevel: null,
        riskScore: null,
        riskFactors: Prisma.JsonNull,
      });
      await recordHistory(tx, id, ctx.employeeId, [
        {
          eventType: TaskEventType.CANCELLED,
          field: 'status',
          oldValue: task.status,
          newValue: { status: TaskStatus.CANCELLED, reason: dto.reason },
        },
      ]);
      await this.insertComment(tx, id, ctx.employeeId, `لغو وظیفه: ${dto.reason}`, CommentKind.DECISION);
    });
    await this.notifier.cancelled(await this.notifiable(id), this.actor(ctx), dto.reason);
    return this.get(ctx, id);
  }

  async reassign(ctx: AuthContext, id: string, dto: ReassignDto): Promise<TaskDetail> {
    const task = await this.access.load(ctx, id, 'canManage');
    assertOpen(task);
    this.checkVersion(task, dto.version);
    if (dto.primaryOwnerId === task.primaryOwnerId) return this.get(ctx, id);
    const owner = await this.activeEmployee(dto.primaryOwnerId, 'مسئول جدید');
    if (!TaskPolicy.canAssignTo(ctx, owner)) throw Errors.forbidden('شما مجاز به تخصیص وظیفه به این فرد نیستید.');
    const previous = task.primaryOwnerId;
    await this.prisma.$transaction(async (tx) => {
      // Remove the new owner's collaborator row (if any) and demote/remove the old owner.
      await tx.taskAssignment.deleteMany({ where: { taskId: id, employeeId: owner.id } });
      if (dto.keepPreviousAsCollaborator) {
        await tx.taskAssignment.updateMany({
          where: { taskId: id, employeeId: previous },
          data: { type: AssignmentType.COLLABORATOR },
        });
      } else {
        await tx.taskAssignment.deleteMany({ where: { taskId: id, employeeId: previous } });
      }
      await tx.taskAssignment.create({
        data: { taskId: id, employeeId: owner.id, type: AssignmentType.PRIMARY, assignedById: ctx.employeeId },
      });
      await this.lockedUpdate(tx, id, task.version, { primaryOwnerId: owner.id, lastActivityAt: new Date() });
      await recordHistory(tx, id, ctx.employeeId, [
        {
          eventType: TaskEventType.REASSIGNED,
          field: 'primaryOwnerId',
          oldValue: previous,
          newValue: { primaryOwnerId: owner.id, reason: dto.reason ?? null },
        },
      ]);
    });
    await this.risk.refresh([id]).catch(() => undefined);
    await this.notifier.reassigned(await this.notifiable(id), previous, this.actor(ctx), dto.reason);
    return this.get(ctx, id);
  }

  async setCollaborators(ctx: AuthContext, id: string, dto: CollaboratorsDto): Promise<TaskDetail> {
    const task = await this.access.load(ctx, id, 'canWork');
    assertOpen(task);
    if (!task.permissions.canManage && task.primaryOwnerId !== ctx.employeeId) {
      throw Errors.forbidden('فقط مسئول اصلی یا مدیر وظیفه می‌تواند همکاران را تغییر دهد.');
    }
    const next = await this.validateCollaborators(dto.employeeIds, task.primaryOwnerId);
    const added = next.filter((e) => !task.collaboratorIds.includes(e));
    const removed = task.collaboratorIds.filter((e) => !next.includes(e));
    if (!added.length && !removed.length) return this.get(ctx, id);
    await this.prisma.$transaction(async (tx) => {
      if (removed.length) {
        await tx.taskAssignment.deleteMany({
          where: { taskId: id, employeeId: { in: removed }, type: AssignmentType.COLLABORATOR },
        });
      }
      if (added.length) {
        await tx.taskAssignment.createMany({
          data: added.map((employeeId) => ({
            taskId: id,
            employeeId,
            type: AssignmentType.COLLABORATOR,
            assignedById: ctx.employeeId,
          })),
        });
      }
      await tx.task.update({ where: { id }, data: { lastActivityAt: new Date(), version: { increment: 1 } } });
      await recordHistory(tx, id, ctx.employeeId, [
        {
          eventType: TaskEventType.COLLABORATORS_CHANGED,
          field: 'collaborators',
          oldValue: task.collaboratorIds,
          newValue: { added, removed },
        },
      ]);
    });
    await this.notifier.collaboratorsAdded(await this.notifiable(id), added, this.actor(ctx));
    return this.get(ctx, id);
  }

  /** PRD §88: move open tasks from one manager to another (only tasks the caller may manage). */
  async bulkReassignManager(ctx: AuthContext, dto: BulkManagerDto): Promise<{ moved: number }> {
    if (ctx.scopes.taskManage === 'self') throw Errors.forbidden();
    await this.activeEmployee(dto.toManagerId, 'مدیر جدید');
    const candidates = await this.prisma.task.findMany({
      where: { managerId: dto.fromManagerId, status: { in: OPEN } },
      include: taskSummaryInclude,
    });
    const allowed = candidates.filter((t) => TaskPolicy.canManage(ctx, accessFacts(t)));
    for (const t of allowed) {
      await this.prisma.$transaction(async (tx) => {
        await tx.task.update({
          where: { id: t.id },
          data: { managerId: dto.toManagerId, version: { increment: 1 }, lastActivityAt: new Date() },
        });
        await recordHistory(tx, t.id, ctx.employeeId, [
          {
            eventType: TaskEventType.MANAGER_CHANGED,
            field: 'managerId',
            oldValue: dto.fromManagerId,
            newValue: dto.toManagerId,
          },
        ]);
      });
    }
    await this.audit.logFor(ctx, {
      action: AuditAction.TASK_CHANGED,
      entityType: 'Task',
      metadata: {
        op: 'bulkReassignManager',
        ...dto,
        moved: allowed.length,
        skipped: candidates.length - allowed.length,
      },
    });
    return { moved: allowed.length };
  }

  /* ================================================================ blockers & delay */

  async addBlocker(ctx: AuthContext, id: string, dto: BlockerInputDto): Promise<TaskDetail> {
    return this.changeStatus(ctx, id, { status: TaskStatus.BLOCKED, blocker: dto });
  }

  async resolveBlocker(ctx: AuthContext, blockerId: string, note?: string): Promise<TaskDetail> {
    const blocker = await this.prisma.blocker.findUnique({ where: { id: blockerId } });
    if (!blocker) throw Errors.notFound('مانع');
    const task = await this.access.load(ctx, blocker.taskId, 'canWork');
    if (blocker.status === BlockerStatus.RESOLVED) return this.get(ctx, task.id);
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.blocker.update({
        where: { id: blockerId },
        data: { status: BlockerStatus.RESOLVED, resolvedAt: now, resolvedById: ctx.employeeId, resolutionNote: note },
      });
      const remaining = await tx.blocker.count({ where: { taskId: task.id, status: BlockerStatus.OPEN } });
      const history: HistoryEntry[] = [
        { eventType: TaskEventType.BLOCKER_RESOLVED, newValue: { blockerId, note: note ?? null } },
      ];
      const data: Prisma.TaskUncheckedUpdateManyInput = { lastActivityAt: now, lastProgressAt: now };
      if (!remaining && task.status === TaskStatus.BLOCKED) {
        data.status = TaskStatus.IN_PROGRESS;
        history.push({
          eventType: TaskEventType.STATUS_CHANGED,
          field: 'status',
          oldValue: TaskStatus.BLOCKED,
          newValue: TaskStatus.IN_PROGRESS,
        });
      }
      await this.lockedUpdate(tx, task.id, task.version, data);
      await recordHistory(tx, task.id, ctx.employeeId, history);
    });
    await this.risk.refresh([task.id]).catch(() => undefined);
    return this.get(ctx, task.id);
  }

  async addDelayReason(ctx: AuthContext, id: string, dto: DelayReasonInputDto): Promise<TaskDetail> {
    const task = await this.access.load(ctx, id, 'canWork');
    if (task.primaryOwnerId !== ctx.employeeId && !task.permissions.canManage) {
      throw Errors.forbidden('دلیل تأخیر را مسئول اصلی یا مدیر وظیفه ثبت می‌کند.');
    }
    const now = new Date();
    const late = now > task.deadline || (task.completedAt && task.completedAt > task.deadline);
    if (!late) throw Errors.validation('مهلت این وظیفه هنوز نگذشته است.');
    await this.prisma.$transaction(async (tx) => {
      await this.insertDelayReason(tx, id, ctx.employeeId, task.deadline, dto);
      await tx.task.update({ where: { id }, data: { lastActivityAt: now } });
      await recordHistory(tx, id, ctx.employeeId, [{ eventType: TaskEventType.DELAY_REASON_ADDED, newValue: dto }]);
    });
    return this.get(ctx, id);
  }

  /* ================================================================ helpers */

  private checkVersion(task: LoadedTask, version?: number) {
    if (version !== undefined && version !== task.version) throw Errors.staleVersion();
  }

  /** Version-guarded update; throws 409 when another user changed the task meanwhile. */
  async lockedUpdate(tx: Db, id: string, version: number, data: Prisma.TaskUncheckedUpdateManyInput) {
    const res = await tx.task.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
    if (res.count === 0) throw Errors.staleVersion();
  }

  async insertComment(tx: Db, taskId: string, authorId: string, content: string, kind: CommentKind) {
    const comment = await tx.taskComment.create({ data: { taskId, authorId, content, kind } });
    await recordHistory(tx, taskId, authorId, [
      { eventType: TaskEventType.COMMENT_ADDED, newValue: { commentId: comment.id, kind } },
    ]);
    return comment;
  }

  private async insertBlocker(tx: Db, taskId: string, createdById: string, dto: BlockerInputDto) {
    let blockingDepartmentManagerId: string | null = null;
    if (dto.blockingEmployeeId) await this.activeEmployee(dto.blockingEmployeeId, 'فرد ایجادکننده مانع');
    if (dto.blockingDepartmentId) {
      const dept = await tx.department.findUnique({ where: { id: dto.blockingDepartmentId } });
      if (!dept) throw Errors.validation('دپارتمان ایجادکننده مانع یافت نشد.');
      blockingDepartmentManagerId = dept.managerId;
    }
    await tx.blocker.create({
      data: {
        taskId,
        type: dto.type,
        description: dto.description,
        blockingEmployeeId: dto.blockingEmployeeId,
        blockingDepartmentId: dto.blockingDepartmentId,
        blockingPartyNote: dto.blockingPartyNote,
        expectedResolutionAt: dto.expectedResolutionAt,
        createdById,
      },
    });
    return { blockingDepartmentManagerId };
  }

  private async insertDelayReason(
    tx: Db,
    taskId: string,
    createdById: string,
    deadlineAt: Date,
    dto: DelayReasonInputDto,
  ) {
    if (dto.reasonType === 'OTHER' && !dto.description?.trim()) {
      throw Errors.validation('برای دلیل «سایر» توضیح الزامی است.');
    }
    await tx.delayReason.create({
      data: { taskId, reasonType: dto.reasonType, description: dto.description, deadlineAt, createdById },
    });
  }

  private assertDates(startDate: Date, deadline: Date, now: Date) {
    if (deadline.getTime() < startDate.getTime()) {
      throw Errors.validation('مهلت انجام نمی‌تواند قبل از تاریخ شروع باشد.');
    }
    if (deadline < startOfZonedDay(now, this.config.timeZone)) {
      throw Errors.validation('مهلت انجام نمی‌تواند در گذشته باشد.');
    }
    const maxKey = addDaysToKey(zonedDateKey(now, this.config.timeZone), 3 * 366);
    if (zonedDateKey(deadline, this.config.timeZone) > maxKey) {
      throw Errors.validation('مهلت انجام بیش از حد دور است.');
    }
  }

  async activeEmployee(id: string, label: string) {
    const e = await this.prisma.employee.findUnique({ where: { id }, include: { user: { select: { status: true } } } });
    if (!e) throw Errors.validation(`${label} یافت نشد.`);
    if (e.employmentStatus === EmploymentStatus.TERMINATED || (e.user && e.user.status === UserStatus.DISABLED)) {
      throw Errors.validation(`${label} (${e.fullName}) دیگر فعال نیست.`);
    }
    return e;
  }

  private async validateCollaborators(ids: string[], ownerId: string): Promise<string[]> {
    const unique = [...new Set(ids)].filter((id) => id !== ownerId);
    if (!unique.length) return [];
    const rows = await this.prisma.employee.findMany({
      where: {
        id: { in: unique },
        employmentStatus: { not: EmploymentStatus.TERMINATED },
        OR: [{ user: null }, { user: { status: { not: UserStatus.DISABLED } } }],
      },
      select: { id: true },
    });
    if (rows.length !== unique.length) throw Errors.validation('یک یا چند همکار انتخاب‌شده معتبر نیستند.');
    return unique;
  }

  async notifiable(id: string): Promise<NotifiableTask> {
    const t = await this.prisma.task.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        number: true,
        title: true,
        deadline: true,
        priority: true,
        primaryOwnerId: true,
        managerId: true,
        assignments: { where: { type: AssignmentType.COLLABORATOR }, select: { employeeId: true } },
      },
    });
    return { ...t, collaboratorIds: t.assignments.map((a) => a.employeeId) };
  }

  /** Overdue open tasks whose current deadline has no recorded delay reason. */
  async delayReasonMissingIds(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT t.id FROM "Task" t
      WHERE t.status IN ('NOT_STARTED', 'IN_PROGRESS', 'WAITING', 'BLOCKED') AND t.deadline < now()
        AND NOT EXISTS (SELECT 1 FROM "DelayReason" d WHERE d."taskId" = t.id AND d."deadlineAt" = t.deadline)`;
    return rows.map((r) => r.id);
  }

  /** Visible open tasks — shared by dashboards and AI context builders. */
  async visibleOpenTasks(ctx: AuthContext, extra: Prisma.TaskWhereInput = {}) {
    return this.prisma.task.findMany({
      where: { AND: [TaskPolicy.visibleWhere(ctx), { status: { in: OPEN } }, extra] },
      include: taskSummaryInclude,
      orderBy: { deadline: 'asc' },
    });
  }
}

export function normalizeTags(tags?: string[]): string[] {
  if (!tags) return [];
  return [...new Set(tags.map((t) => normalizePersian(t).replace(/^#/, '')).filter(Boolean))].slice(0, 10);
}

export const RISK_ORDER: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
