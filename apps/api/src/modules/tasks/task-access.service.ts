import { Injectable } from '@nestjs/common';
import { AssignmentType } from '@prisma/client';
import type { TaskPermissions } from '@karban/shared';
import { PrismaService, type Db } from '../../prisma/prisma.service';
import type { AuthContext } from '../../common/auth-context';
import { Errors } from '../../common/errors';
import { TaskPolicy, type TaskAccessFacts } from '../access/access-policy';

export type TaskCapability = keyof Omit<TaskPermissions, 'canView'> | 'canView';

export interface LoadedTask extends TaskAccessFacts {
  number: number;
  title: string;
  deadline: Date;
  startDate: Date;
  priority: import('@prisma/client').TaskPriority;
  status: import('@prisma/client').TaskStatus;
  progress: number;
  version: number;
  completedAt: Date | null;
  requiresReview: boolean;
  collaboratorIds: string[];
  permissions: TaskPermissions;
}

const CAPABILITY_MESSAGES: Partial<Record<TaskCapability, string>> = {
  canView: 'شما به این وظیفه دسترسی ندارید.',
  canWork: 'فقط مسئول، همکاران یا مدیر این وظیفه می‌توانند آن را به‌روزرسانی کنند.',
  canEdit: 'فقط مدیر وظیفه می‌تواند جزئیات آن را ویرایش کند.',
  canManage: 'فقط مدیر وظیفه مجاز به این عملیات است.',
  canComplete: 'فقط مسئول اصلی یا مدیر وظیفه می‌تواند آن را تکمیل کند.',
  canReview: 'این وظیفه در انتظار بررسی شما نیست.',
  canReopen: 'فقط مدیر وظیفه می‌تواند آن را بازگشایی کند.',
  canCancel: 'فقط مدیر وظیفه می‌تواند آن را لغو کند.',
};

export const CLOSED_MESSAGE = 'این وظیفه بسته شده است؛ برای ادامه ابتدا آن را بازگشایی کنید.';

export function assertOpen(task: { status: string }) {
  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') throw Errors.validation(CLOSED_MESSAGE);
}

/** Loads a task's access facts and enforces a capability (404 if missing, 403 if denied). */
@Injectable()
export class TaskAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async load(
    ctx: AuthContext,
    taskId: string,
    capability: TaskCapability = 'canView',
    db: Db = this.prisma,
  ): Promise<LoadedTask> {
    const task = await db.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        number: true,
        title: true,
        departmentId: true,
        primaryOwnerId: true,
        managerId: true,
        creatorId: true,
        confidential: true,
        status: true,
        reviewStatus: true,
        deadline: true,
        startDate: true,
        priority: true,
        progress: true,
        version: true,
        completedAt: true,
        requiresReview: true,
        assignments: { select: { employeeId: true, type: true } },
      },
    });
    if (!task) throw Errors.notFound('وظیفه');
    const collaboratorIds = task.assignments
      .filter((a) => a.type === AssignmentType.COLLABORATOR)
      .map((a) => a.employeeId);
    const facts: TaskAccessFacts = {
      ...task,
      participantIds: [task.primaryOwnerId, ...collaboratorIds],
    };
    const permissions = TaskPolicy.permissions(ctx, facts);
    if (!permissions.canView) throw Errors.forbidden(CAPABILITY_MESSAGES.canView);
    if (!permissions[capability]) {
      const closed = task.status === 'COMPLETED' || task.status === 'CANCELLED';
      if (closed && TaskPolicy.permissions(ctx, { ...facts, status: 'IN_PROGRESS' })[capability]) {
        throw Errors.validation(CLOSED_MESSAGE);
      }
      throw Errors.forbidden(CAPABILITY_MESSAGES[capability]);
    }
    return { ...task, participantIds: facts.participantIds, collaboratorIds, permissions };
  }
}
