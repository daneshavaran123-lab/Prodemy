import { AssignmentType, BlockerStatus, Prisma, TaskStatus } from '@prisma/client';
import {
  delayDays,
  isTaskOverdue,
  type RiskAssessment,
  type RiskFactor,
  type TaskDetail,
  type TaskPermissions,
  type TaskSummary,
} from '@karban/shared';
import { departmentRefSelect, employeeRefSelect, iso, toEmployeeRef } from '../../common/serializers';
import type { TaskAccessFacts } from '../access/access-policy';

export const taskCode = (n: number) => `KB-${n}`;

export const taskSummaryInclude = {
  department: { select: departmentRefSelect },
  primaryOwner: { select: employeeRefSelect },
  manager: { select: employeeRefSelect },
  project: { select: { id: true, name: true } },
  assignments: {
    where: { type: AssignmentType.COLLABORATOR },
    include: { employee: { select: employeeRefSelect } },
    orderBy: { assignedAt: 'asc' },
  },
  blockers: { where: { status: BlockerStatus.OPEN }, select: { id: true } },
  delayReasons: { select: { deadlineAt: true } },
  subtasks: { select: { status: true } },
  _count: { select: { comments: true, attachments: { where: { deletedAt: null } } } },
} satisfies Prisma.TaskInclude;

export type TaskSummaryRow = Prisma.TaskGetPayload<{ include: typeof taskSummaryInclude }>;

export const taskDetailInclude = {
  ...taskSummaryInclude,
  creator: { select: employeeRefSelect },
  subtasks: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: { owner: { select: employeeRefSelect } },
  },
  blockers: {
    orderBy: { createdAt: 'desc' },
    include: {
      blockingEmployee: { select: employeeRefSelect },
      blockingDepartment: { select: departmentRefSelect },
      createdBy: { select: employeeRefSelect },
    },
  },
  delayReasons: {
    orderBy: { createdAt: 'desc' },
    include: { createdBy: { select: employeeRefSelect } },
  },
  attachments: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    include: { uploader: { select: employeeRefSelect } },
  },
  recurrence: true,
} satisfies Prisma.TaskInclude;

export type TaskDetailRow = Prisma.TaskGetPayload<{ include: typeof taskDetailInclude }>;

/** Facts for authorization from a summary/detail row. */
export function accessFacts(t: TaskSummaryRow | TaskDetailRow): TaskAccessFacts {
  return {
    id: t.id,
    departmentId: t.departmentId,
    primaryOwnerId: t.primaryOwnerId,
    managerId: t.managerId,
    creatorId: t.creatorId,
    confidential: t.confidential,
    status: t.status,
    reviewStatus: t.reviewStatus,
    participantIds: [t.primaryOwnerId, ...t.assignments.map((a) => a.employeeId)],
  };
}

export function riskOf(t: {
  riskLevel: string | null;
  riskScore: number | null;
  riskFactors: Prisma.JsonValue | null;
  riskAssessedAt: Date | null;
}): RiskAssessment | null {
  if (!t.riskLevel || t.riskAssessedAt === null) return null;
  return {
    level: t.riskLevel as RiskAssessment['level'],
    score: t.riskScore ?? 0,
    factors: (t.riskFactors as unknown as RiskFactor[]) ?? [],
    assessedAt: t.riskAssessedAt.toISOString(),
  };
}

/** Does the current deadline still need an explanation (PRD §27–28)? */
export function needsDelayReason(
  t: { status: TaskStatus; deadline: Date; completedAt: Date | null },
  reasons: { deadlineAt: Date }[],
  now: Date,
): boolean {
  const late =
    isTaskOverdue(t.status, t.deadline, now) ||
    (t.status === TaskStatus.COMPLETED && !!t.completedAt && t.completedAt > t.deadline);
  if (!late) return false;
  return !reasons.some((r) => r.deadlineAt.getTime() === t.deadline.getTime());
}

export function toTaskSummary(t: TaskSummaryRow | TaskDetailRow, now = new Date()): TaskSummary {
  const overdue = isTaskOverdue(t.status, t.deadline, now);
  const reference = t.status === TaskStatus.COMPLETED && t.completedAt ? t.completedAt : now;
  const openBlockers = (t.blockers as Array<{ id: string; status?: BlockerStatus }>).filter(
    (b) => b.status === undefined || b.status === BlockerStatus.OPEN,
  );
  return {
    id: t.id,
    code: taskCode(t.number),
    title: t.title,
    status: t.status,
    priority: t.priority,
    progress: t.progress,
    startDate: t.startDate.toISOString(),
    deadline: t.deadline.toISOString(),
    department: t.department,
    primaryOwner: toEmployeeRef(t.primaryOwner)!,
    manager: toEmployeeRef(t.manager)!,
    collaborators: t.assignments.map((a) => toEmployeeRef(a.employee)!),
    tags: t.tags,
    category: t.category,
    project: t.project,
    isOverdue: overdue,
    delayDays: t.status === TaskStatus.CANCELLED ? 0 : delayDays(t.deadline, reference),
    delayReasonRequired: needsDelayReason(t, t.delayReasons, now),
    hasOpenBlocker: openBlockers.length > 0,
    risk: t.status === TaskStatus.COMPLETED || t.status === TaskStatus.CANCELLED ? null : riskOf(t),
    reviewStatus: t.reviewStatus,
    confidential: t.confidential,
    subtaskCount: t.subtasks.length,
    subtaskDoneCount: t.subtasks.filter((s) => s.status === TaskStatus.COMPLETED).length,
    commentCount: t._count.comments,
    attachmentCount: t._count.attachments,
    recurrenceId: t.recurrenceId,
    completedAt: iso(t.completedAt),
    lastActivityAt: t.lastActivityAt.toISOString(),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function toTaskDetail(t: TaskDetailRow, permissions: TaskPermissions, now = new Date()): TaskDetail {
  return {
    ...toTaskSummary(t, now),
    description: t.description,
    estimatedEffortHours: t.estimatedEffortHours,
    requiresReview: t.requiresReview,
    creator: toEmployeeRef(t.creator)!,
    version: t.version,
    overdueAt: iso(t.overdueAt),
    cancelledAt: iso(t.cancelledAt),
    subtasks: t.subtasks.map((s) => ({
      id: s.id,
      title: s.title,
      owner: toEmployeeRef(s.owner),
      deadline: iso(s.deadline),
      status: s.status,
      progress: s.progress,
      sortOrder: s.sortOrder,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
    blockers: t.blockers.map((b) => ({
      id: b.id,
      type: b.type,
      description: b.description,
      blockingEmployee: toEmployeeRef(b.blockingEmployee),
      blockingDepartment: b.blockingDepartment,
      blockingPartyNote: b.blockingPartyNote,
      expectedResolutionAt: iso(b.expectedResolutionAt),
      status: b.status,
      createdBy: toEmployeeRef(b.createdBy),
      createdAt: b.createdAt.toISOString(),
      resolvedAt: iso(b.resolvedAt),
      resolutionNote: b.resolutionNote,
    })),
    delayReasons: t.delayReasons.map((d) => ({
      id: d.id,
      reasonType: d.reasonType,
      description: d.description,
      deadlineAt: d.deadlineAt.toISOString(),
      createdBy: toEmployeeRef(d.createdBy),
      createdAt: d.createdAt.toISOString(),
    })),
    attachments: t.attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      size: a.size,
      uploader: toEmployeeRef(a.uploader),
      createdAt: a.createdAt.toISOString(),
    })),
    recurrence: t.recurrence
      ? {
          id: t.recurrence.id,
          frequency: t.recurrence.frequency,
          interval: t.recurrence.interval,
          weekdays: t.recurrence.weekdays,
          dayOfMonth: t.recurrence.dayOfMonth,
          active: t.recurrence.active,
          nextRunAt: t.recurrence.nextOccurrence,
          endDate: t.recurrence.endDate,
        }
      : null,
    permissions,
  };
}
