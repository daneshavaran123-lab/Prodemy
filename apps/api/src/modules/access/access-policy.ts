import { Prisma } from '@prisma/client';
import { Permission, type TaskPermissions, type TaskScope } from '@karban/shared';
import type { AuthContext } from '../../common/auth-context';

/** Minimal task facts needed for authorization decisions. */
export interface TaskAccessFacts {
  id: string;
  departmentId: string;
  primaryOwnerId: string;
  managerId: string;
  creatorId: string;
  confidential: boolean;
  status: string;
  reviewStatus: string;
  participantIds: string[];
}

const SCOPE_RANK: Record<TaskScope, number> = { self: 0, team: 1, department: 2, all: 3 };
export const scopeAtLeast = (scope: TaskScope, min: TaskScope) => SCOPE_RANK[scope] >= SCOPE_RANK[min];

/**
 * Task authorization rules — RBAC + department isolation + relationship (PRD §12, §102).
 *
 * View:   participants (owner, collaborators), task manager and creator always; plus
 *         team scope → non-confidential tasks owned by team members,
 *         department scope → every task of own/managed departments,
 *         all scope → everything.
 * Manage: task manager/creator; team scope over team members' non-confidential tasks;
 *         department scope over department tasks; all scope.
 */
export const TaskPolicy = {
  /** Prisma filter restricting a task query to what `ctx` may see. */
  visibleWhere(ctx: AuthContext): Prisma.TaskWhereInput {
    const scope = ctx.scopes.taskView;
    if (scope === 'all') return {};
    const or: Prisma.TaskWhereInput[] = [
      { assignments: { some: { employeeId: ctx.employeeId } } },
      { managerId: ctx.employeeId },
      { creatorId: ctx.employeeId },
    ];
    if (scopeAtLeast(scope, 'department')) {
      or.push({ departmentId: { in: ctx.departmentScopeIds } });
    }
    if (scopeAtLeast(scope, 'team') && ctx.teamMemberIds.length) {
      or.push({ primaryOwnerId: { in: ctx.teamMemberIds }, confidential: false });
    }
    return { OR: or };
  },

  isParticipant(ctx: AuthContext, t: TaskAccessFacts): boolean {
    return t.primaryOwnerId === ctx.employeeId || t.participantIds.includes(ctx.employeeId);
  },

  canView(ctx: AuthContext, t: TaskAccessFacts): boolean {
    if (ctx.scopes.taskView === 'all') return true;
    if (this.isParticipant(ctx, t) || t.managerId === ctx.employeeId || t.creatorId === ctx.employeeId) {
      return true;
    }
    const scope = ctx.scopes.taskView;
    if (scopeAtLeast(scope, 'department') && ctx.departmentScopeIds.includes(t.departmentId)) return true;
    if (scopeAtLeast(scope, 'team') && !t.confidential && ctx.teamMemberIds.includes(t.primaryOwnerId)) {
      return true;
    }
    return false;
  },

  canManage(ctx: AuthContext, t: TaskAccessFacts): boolean {
    const scope = ctx.scopes.taskManage;
    if (scope === 'all') return true;
    if (t.managerId === ctx.employeeId || t.creatorId === ctx.employeeId) return true;
    if (scopeAtLeast(scope, 'department') && ctx.departmentScopeIds.includes(t.departmentId)) return true;
    if (scopeAtLeast(scope, 'team') && !t.confidential && ctx.teamMemberIds.includes(t.primaryOwnerId)) {
      return true;
    }
    return false;
  },

  permissions(ctx: AuthContext, t: TaskAccessFacts): TaskPermissions {
    const canView = this.canView(ctx, t);
    const canManage = canView && this.canManage(ctx, t);
    const participant = this.isParticipant(ctx, t);
    const isOwner = t.primaryOwnerId === ctx.employeeId;
    const open = !['COMPLETED', 'CANCELLED'].includes(t.status);
    return {
      canView,
      canWork: canView && (participant || canManage),
      canEdit: canManage && open,
      canManage,
      canComplete: open && (isOwner || canManage),
      // A manager accepts someone else's completion; owners never review themselves.
      canReview:
        t.status === 'COMPLETED' &&
        t.reviewStatus === 'PENDING' &&
        canManage &&
        (!isOwner || ctx.scopes.taskManage === 'all'),
      canReopen: !open && canManage,
      canCancel: open && canManage,
      canComment: canView,
    };
  },

  /**
   * May `ctx` make `owner` the primary owner of a task?
   * Everyone may assign to themselves (personal tasks).
   */
  canAssignTo(ctx: AuthContext, owner: { id: string; departmentId: string }): boolean {
    if (owner.id === ctx.employeeId) {
      return ctx.permissions.has(Permission.TASK_CREATE_SELF) || ctx.scopes.taskManage !== 'self';
    }
    const scope = ctx.scopes.taskManage;
    if (scope === 'all') return true;
    if (scopeAtLeast(scope, 'department') && ctx.departmentScopeIds.includes(owner.departmentId)) return true;
    if (scopeAtLeast(scope, 'team') && ctx.teamMemberIds.includes(owner.id)) return true;
    return false;
  },

  /** Employees whose data (reports, workload) `ctx` may see, as a Prisma filter. */
  visibleEmployeesWhere(ctx: AuthContext, scope: TaskScope): Prisma.EmployeeWhereInput {
    if (scope === 'all') return {};
    if (scope === 'department') return { departmentId: { in: ctx.departmentScopeIds } };
    if (scope === 'team') return { id: { in: [ctx.employeeId, ...ctx.teamMemberIds] } };
    return { id: ctx.employeeId };
  },
};
