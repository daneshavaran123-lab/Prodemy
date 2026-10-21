import type { TaskScope } from '@karban/shared';

/** Authenticated principal attached to every request by the AuthGuard. */
export interface AuthContext {
  userId: string;
  username: string;
  sessionId: string;
  employeeId: string;
  fullName: string;
  departmentId: string;
  teamId: string | null;
  managerId: string | null;
  roleId: string;
  roleCode: string;
  permissions: ReadonlySet<string>;
  scopes: { taskView: TaskScope; taskManage: TaskScope; report: TaskScope };
  /** Own department plus departments this employee manages. */
  departmentScopeIds: string[];
  /** Departments where this employee is the appointed manager. */
  managesDepartmentIds: string[];
  /** Teams this employee leads. */
  ledTeamIds: string[];
  /** Members of led teams plus direct reports (excluding self). Empty without team permissions. */
  teamMemberIds: string[];
  ip?: string;
  userAgent?: string;
}

export function hasPermission(ctx: AuthContext, code: string): boolean {
  return ctx.permissions.has(code);
}

/** System actor used by scheduled jobs (recurrence, reminders). */
export const SYSTEM_ACTOR = null;
