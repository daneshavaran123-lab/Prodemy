import { Injectable } from '@nestjs/common';
import { BlockerStatus, EmploymentStatus, Prisma, TaskStatus, UserStatus } from '@prisma/client';
import {
  DAY_MS,
  OPEN_TASK_STATUSES,
  endOfZonedDay,
  isOpenStatus,
  type ActivityItem,
  type AttentionReason,
  type BlockerHotspot,
  type DelayReasonStat,
  type DepartmentDashboard,
  type EmployeeDashboard,
  type KpiSet,
  type ManagerDashboard,
  type NeedsAttentionItem,
  type OrganizationDashboard,
  type TaskPriority,
  type TaskScope,
  type TaskStatus as TaskStatusT,
  type TaskSummary,
  type WorkloadRow,
} from '@karban/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { OrgService } from '../org/org.service';
import { InjectConfig } from '../../config/config.module';
import type { AppConfig } from '../../config/config';
import type { AuthContext } from '../../common/auth-context';
import { Errors } from '../../common/errors';
import { employeeRefSelect, toEmployeeRef } from '../../common/serializers';
import { TaskPolicy, scopeAtLeast } from '../access/access-policy';
import { taskCode, taskSummaryInclude, toTaskSummary, type TaskSummaryRow } from '../tasks/task.mapper';
import {
  computeKpis,
  computeWorkload,
  weeklyTrend,
  type MetricTask,
  type Period,
  type WorkloadEmployee,
} from './metrics';

const OPEN = OPEN_TASK_STATUSES as TaskStatus[];
const LIST_LIMIT = 15;
const DEFAULT_PERIOD_DAYS = 30;
const TREND_WEEKS = 12;

export interface ScopeData {
  rows: TaskSummaryRow[];
  summaries: TaskSummary[];
  metric: MetricTask[];
  inactiveOwnerIds: Set<string>;
}

function toMetric(r: TaskSummaryRow): MetricTask {
  return {
    id: r.id,
    status: r.status,
    priority: r.priority,
    deadline: r.deadline,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
    cancelledAt: r.cancelledAt,
    primaryOwnerId: r.primaryOwnerId,
    departmentId: r.departmentId,
    riskLevel: r.riskLevel,
    reviewStatus: r.reviewStatus,
    hasOpenBlocker: r.blockers.length > 0,
  };
}

const byDeadline = (a: TaskSummary, b: TaskSummary) => a.deadline.localeCompare(b.deadline);
const PRIORITY_RANK: Record<TaskPriority, number> = { URGENT: 4, HIGH: 3, NORMAL: 2, LOW: 1 };

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly org: OrgService,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  defaultPeriod(now = new Date()): Period {
    return { from: new Date(now.getTime() - DEFAULT_PERIOD_DAYS * DAY_MS), to: now };
  }

  /**
   * Loads every task relevant to a scope: all open tasks plus tasks created, completed
   * or cancelled since `since`. Visibility is always enforced on top of `scope`.
   */
  async loadScope(
    ctx: AuthContext | null,
    scope: Prisma.TaskWhereInput,
    since: Date,
    now = new Date(),
  ): Promise<ScopeData> {
    const rows = await this.prisma.task.findMany({
      where: {
        AND: [
          ctx ? TaskPolicy.visibleWhere(ctx) : {},
          scope,
          {
            OR: [
              { status: { in: OPEN } },
              { completedAt: { gte: since } },
              { cancelledAt: { gte: since } },
              { createdAt: { gte: since } },
              { deadline: { gte: since, lte: now } },
            ],
          },
        ],
      },
      include: taskSummaryInclude,
      orderBy: { deadline: 'asc' },
    });
    const ownerIds = [...new Set(rows.map((r) => r.primaryOwnerId))];
    const inactive = await this.prisma.employee.findMany({
      where: {
        id: { in: ownerIds },
        OR: [{ employmentStatus: EmploymentStatus.TERMINATED }, { user: { status: UserStatus.DISABLED } }],
      },
      select: { id: true },
    });
    return {
      rows,
      summaries: rows.map((r) => toTaskSummary(r, now)),
      metric: rows.map(toMetric),
      inactiveOwnerIds: new Set(inactive.map((e) => e.id)),
    };
  }

  async workloadEmployees(where: Prisma.EmployeeWhereInput): Promise<WorkloadEmployee[]> {
    const rows = await this.prisma.employee.findMany({
      where: {
        AND: [
          where,
          { employmentStatus: { not: EmploymentStatus.TERMINATED } },
          { OR: [{ user: null }, { user: { status: UserStatus.ACTIVE } }] },
        ],
      },
      include: { department: { select: { name: true } } },
      orderBy: { fullName: 'asc' },
    });
    return rows.map((e) => ({
      id: e.id,
      fullName: e.fullName,
      jobTitle: e.jobTitle,
      departmentId: e.departmentId,
      departmentName: e.department.name,
      onLeave: e.employmentStatus === EmploymentStatus.ON_LEAVE,
    }));
  }

  async workload(employees: WorkloadEmployee[], metric: MetricTask[], now = new Date()): Promise<WorkloadRow[]> {
    const s = await this.settings.get();
    return computeWorkload(employees, metric, now, {
      overload: s.overloadThreshold,
      underutilized: s.underutilizedThreshold,
    });
  }

  /* ================================================================ employee (PRD §33) */

  async employee(ctx: AuthContext, now = new Date()): Promise<EmployeeDashboard> {
    const since = new Date(now.getTime() - 7 * DAY_MS);
    const data = await this.loadScope(ctx, { assignments: { some: { employeeId: ctx.employeeId } } }, since, now);
    const owned = data.summaries.filter((t) => t.primaryOwner.id === ctx.employeeId);
    const open = owned.filter((t) => isOpenStatus(t.status));
    const endToday = endOfZonedDay(now, this.config.timeZone);
    const soonLimit = new Date(endToday.getTime() + 3 * DAY_MS);
    const deadline = (t: TaskSummary) => new Date(t.deadline);

    const today = open.filter((t) => deadline(t) >= now && deadline(t) <= endToday);
    const overdue = open.filter((t) => t.isOverdue).sort(byDeadline);
    const dueSoon = open.filter((t) => deadline(t) > endToday && deadline(t) <= soonLimit).sort(byDeadline);
    const highPriority = open
      .filter((t) => (t.priority === 'HIGH' || t.priority === 'URGENT') && !t.isOverdue)
      .sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || byDeadline(a, b));
    const blocked = open.filter((t) => t.status === 'BLOCKED' || t.hasOpenBlocker);
    const recentlyCompleted = owned
      .filter((t) => t.status === 'COMPLETED' && t.completedAt && new Date(t.completedAt) >= since)
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
    const delayReasonRequired = owned.filter((t) => t.delayReasonRequired);
    const collaborating = data.summaries
      .filter((t) => t.primaryOwner.id !== ctx.employeeId && isOpenStatus(t.status))
      .sort(byDeadline);

    return {
      summary: {
        active: open.length,
        dueToday: today.length,
        overdue: overdue.length,
        dueSoon: dueSoon.length,
        blocked: blocked.length,
        completedThisWeek: recentlyCompleted.length,
        pendingDelayReasons: delayReasonRequired.length,
      },
      today: today.sort(byDeadline),
      overdue,
      dueSoon: dueSoon.slice(0, LIST_LIMIT),
      highPriority: highPriority.slice(0, LIST_LIMIT),
      blocked,
      recentlyCompleted: recentlyCompleted.slice(0, 10),
      delayReasonRequired,
      collaborating: collaborating.slice(0, LIST_LIMIT),
    };
  }

  /* ================================================================ manager (PRD §34–35) */

  /** Resolves the team/department a manager dashboard covers. */
  private async managerScope(ctx: AuthContext, departmentId?: string) {
    const view = ctx.scopes.taskView;
    if (departmentId) {
      if (view !== 'all' && !ctx.departmentScopeIds.includes(departmentId)) {
        throw Errors.forbidden('شما به داشبورد این دپارتمان دسترسی ندارید.');
      }
      const d = await this.prisma.department.findUnique({ where: { id: departmentId } });
      if (!d) throw Errors.notFound('دپارتمان');
      return {
        type: 'department' as TaskScope,
        departmentId,
        label: d.name,
        tasks: { departmentId } as Prisma.TaskWhereInput,
        employees: { departmentId } as Prisma.EmployeeWhereInput,
      };
    }
    if (scopeAtLeast(view, 'department')) {
      const ids = ctx.managesDepartmentIds.length ? ctx.managesDepartmentIds : [ctx.departmentId];
      const depts = await this.prisma.department.findMany({ where: { id: { in: ids } }, select: { name: true } });
      return {
        type: 'department' as TaskScope,
        departmentId: ids.length === 1 ? ids[0] : null,
        label: depts.map((d) => d.name).join('، '),
        tasks: { departmentId: { in: ids } } as Prisma.TaskWhereInput,
        employees: { departmentId: { in: ids } } as Prisma.EmployeeWhereInput,
      };
    }
    const members = [ctx.employeeId, ...ctx.teamMemberIds];
    if (view === 'team' || ctx.teamMemberIds.length) {
      return {
        type: 'team' as TaskScope,
        departmentId: null,
        label: 'تیم من',
        tasks: { OR: [{ primaryOwnerId: { in: members } }, { managerId: ctx.employeeId }] } as Prisma.TaskWhereInput,
        employees: { id: { in: members } } as Prisma.EmployeeWhereInput,
      };
    }
    // Employees who supervise individual tasks still get a dashboard of those tasks.
    return {
      type: 'self' as TaskScope,
      departmentId: null,
      label: 'وظایفی که مدیر آن‌ها هستم',
      tasks: { managerId: ctx.employeeId } as Prisma.TaskWhereInput,
      employees: { id: ctx.employeeId } as Prisma.EmployeeWhereInput,
    };
  }

  attention(data: ScopeData, staleDays: number, now: Date): NeedsAttentionItem[] {
    const items: NeedsAttentionItem[] = [];
    const weights: Record<AttentionReason, number> = {
      CRITICAL_OVERDUE: 50,
      OVERDUE: 30,
      BLOCKED: 30,
      HIGH_RISK: 25,
      OWNER_INACTIVE: 40,
      DELAY_REASON_MISSING: 15,
      PENDING_REVIEW: 10,
      NEAR_DEADLINE: 15,
      NO_RECENT_UPDATE: 10,
      HIGH_PRIORITY: 10,
    };
    data.rows.forEach((row, i) => {
      const t = data.summaries[i];
      const reasons: AttentionReason[] = [];
      if (t.status === 'COMPLETED' && t.reviewStatus === 'PENDING') reasons.push('PENDING_REVIEW');
      if (isOpenStatus(t.status)) {
        if (t.isOverdue) {
          reasons.push(
            t.priority === 'URGENT' || t.priority === 'HIGH' || t.delayDays >= 3 ? 'CRITICAL_OVERDUE' : 'OVERDUE',
          );
        }
        if (t.status === 'BLOCKED' || t.hasOpenBlocker) reasons.push('BLOCKED');
        if (!t.isOverdue && t.risk?.level === 'HIGH') reasons.push('HIGH_RISK');
        if (data.inactiveOwnerIds.has(row.primaryOwnerId)) reasons.push('OWNER_INACTIVE');
        if (t.delayReasonRequired) reasons.push('DELAY_REASON_MISSING');
        const left = new Date(t.deadline).getTime() - now.getTime();
        if (!t.isOverdue && left <= DAY_MS && t.progress < 80) reasons.push('NEAR_DEADLINE');
        if (now.getTime() - row.lastProgressAt.getTime() >= staleDays * DAY_MS && row.startDate <= now) {
          reasons.push('NO_RECENT_UPDATE');
        }
        if (t.priority === 'URGENT' && t.status === 'NOT_STARTED') reasons.push('HIGH_PRIORITY');
      }
      if (reasons.length) {
        items.push({ task: t, reasons, severity: reasons.reduce((s, r) => s + weights[r], 0) });
      }
    });
    return items.sort((a, b) => b.severity - a.severity || a.task.deadline.localeCompare(b.task.deadline)).slice(0, 30);
  }

  async recentActivity(where: Prisma.TaskWhereInput, take = 20): Promise<ActivityItem[]> {
    const rows = await this.prisma.taskHistory.findMany({
      where: { task: where, eventType: { notIn: ['COMMENT_ADDED'] } },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        actor: { select: employeeRefSelect },
        task: { select: { id: true, number: true, title: true } },
      },
    });
    return rows.map((h) => ({
      id: h.id,
      task: { id: h.task.id, code: taskCode(h.task.number), title: h.task.title },
      actor: toEmployeeRef(h.actor),
      eventType: h.eventType,
      field: h.field,
      oldValue: h.oldValue,
      newValue: h.newValue,
      createdAt: h.createdAt.toISOString(),
    }));
  }

  distribution(summaries: TaskSummary[]) {
    const byStatus = Object.fromEntries(
      (['NOT_STARTED', 'IN_PROGRESS', 'WAITING', 'BLOCKED', 'COMPLETED', 'CANCELLED'] as TaskStatusT[]).map((s) => [
        s,
        0,
      ]),
    ) as Record<TaskStatusT, number>;
    const byPriority = { LOW: 0, NORMAL: 0, HIGH: 0, URGENT: 0 } as Record<TaskPriority, number>;
    for (const t of summaries) {
      byStatus[t.status]++;
      if (isOpenStatus(t.status)) byPriority[t.priority]++;
    }
    return { byStatus, byPriority };
  }

  async manager(ctx: AuthContext, departmentId?: string, now = new Date()): Promise<ManagerDashboard> {
    const scope = await this.managerScope(ctx, departmentId);
    const period = this.defaultPeriod(now);
    const data = await this.loadScope(ctx, scope.tasks, period.from, now);
    const settings = await this.settings.get();
    const employees = await this.workloadEmployees(scope.employees);
    const open = data.summaries.filter((t) => isOpenStatus(t.status));
    const soon = now.getTime() + 3 * DAY_MS;
    const riskRank = (t: TaskSummary) => t.risk?.score ?? 0;

    return {
      scope: { type: scope.type, departmentId: scope.departmentId, label: scope.label },
      kpis: computeKpis(data.metric, employees.length, now, period),
      needsAttention: this.attention(data, settings.staleTaskDays, now),
      active: open.slice(0, LIST_LIMIT),
      overdue: open
        .filter((t) => t.isOverdue)
        .sort((a, b) => b.delayDays - a.delayDays)
        .slice(0, LIST_LIMIT),
      atRisk: open
        .filter((t) => !t.isOverdue && (t.risk?.level === 'HIGH' || t.risk?.level === 'MEDIUM'))
        .sort((a, b) => riskRank(b) - riskRank(a))
        .slice(0, LIST_LIMIT),
      blocked: open.filter((t) => t.status === 'BLOCKED' || t.hasOpenBlocker),
      approaching: open
        .filter((t) => !t.isOverdue && new Date(t.deadline).getTime() <= soon)
        .sort(byDeadline)
        .slice(0, LIST_LIMIT),
      pendingReview: data.summaries.filter((t) => t.status === 'COMPLETED' && t.reviewStatus === 'PENDING'),
      recentlyCompleted: data.summaries
        .filter((t) => t.status === 'COMPLETED')
        .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
        .slice(0, 10),
      workload: await this.workload(employees, data.metric, now),
      distribution: this.distribution(data.summaries),
      recentActivity: await this.recentActivity({ AND: [TaskPolicy.visibleWhere(ctx), scope.tasks] }),
    };
  }

  /* ================================================================ department (PRD §36) */

  assertDepartmentAccess(ctx: AuthContext, departmentId: string) {
    const scope = ctx.scopes.report;
    const ok =
      scope === 'all' ||
      (scopeAtLeast(scope, 'department') && ctx.departmentScopeIds.includes(departmentId)) ||
      ctx.managesDepartmentIds.includes(departmentId);
    if (!ok) throw Errors.forbidden('شما به اطلاعات این دپارتمان دسترسی ندارید.');
  }

  async blockerHotspots(where: Prisma.TaskWhereInput, now = new Date()): Promise<BlockerHotspot[]> {
    const blockers = await this.prisma.blocker.findMany({
      where: { status: BlockerStatus.OPEN, task: { AND: [where, { status: { in: OPEN } }] } },
      include: {
        blockingDepartment: { select: { id: true, name: true } },
        blockingEmployee: { select: employeeRefSelect },
      },
    });
    const groups = new Map<string, { b: (typeof blockers)[number]; tasks: Set<string>; days: number[] }>();
    for (const b of blockers) {
      const key = b.blockingDepartmentId ?? b.blockingEmployeeId ?? `type:${b.type}`;
      const g = groups.get(key) ?? { b, tasks: new Set<string>(), days: [] };
      g.tasks.add(b.taskId);
      g.days.push((now.getTime() - b.createdAt.getTime()) / DAY_MS);
      groups.set(key, g);
    }
    return [...groups.values()]
      .map(({ b, tasks, days }) => ({
        department: b.blockingDepartment,
        employee: toEmployeeRef(b.blockingEmployee),
        label: b.blockingDepartment?.name ?? b.blockingEmployee?.fullName ?? b.blockingPartyNote ?? 'نامشخص',
        openBlockers: days.length,
        affectedTasks: tasks.size,
        avgOpenDays: Math.round((days.reduce((a, c) => a + c, 0) / days.length) * 10) / 10,
      }))
      .sort((a, b) => b.openBlockers - a.openBlockers)
      .slice(0, 10);
  }

  async delayReasonStats(where: Prisma.TaskWhereInput, since: Date): Promise<DelayReasonStat[]> {
    const rows = await this.prisma.delayReason.groupBy({
      by: ['reasonType'],
      where: { createdAt: { gte: since }, task: where },
      _count: { _all: true },
    });
    return rows.map((r) => ({ reasonType: r.reasonType, count: r._count._all })).sort((a, b) => b.count - a.count);
  }

  async department(ctx: AuthContext, departmentId: string, now = new Date()): Promise<DepartmentDashboard> {
    this.assertDepartmentAccess(ctx, departmentId);
    const department = await this.org.getDepartment(departmentId);
    const period = this.defaultPeriod(now);
    const trendSince = new Date(now.getTime() - TREND_WEEKS * 7 * DAY_MS);
    const where: Prisma.TaskWhereInput = { departmentId };
    // Department dashboards aggregate the whole department regardless of task-level visibility,
    // since access to the department was verified above.
    const data = await this.loadScope(null, where, trendSince, now);
    const employees = await this.workloadEmployees({ departmentId });
    const open = data.summaries.filter((t) => isOpenStatus(t.status));
    const teams = await this.prisma.team.findMany({
      where: { departmentId, status: 'ACTIVE' },
      include: { members: { select: { id: true } } },
      orderBy: { name: 'asc' },
    });
    const visible = (t: TaskSummary, i: number) =>
      TaskPolicy.canView(ctx, {
        id: t.id,
        departmentId: t.department.id,
        primaryOwnerId: t.primaryOwner.id,
        managerId: t.manager.id,
        creatorId: data.rows[i].creatorId,
        confidential: t.confidential,
        status: t.status,
        reviewStatus: t.reviewStatus,
        participantIds: [t.primaryOwner.id, ...t.collaborators.map((c) => c.id)],
      });
    const visibleOpen = open.filter((t) => visible(t, data.summaries.indexOf(t)));

    return {
      department,
      kpis: computeKpis(data.metric, employees.length, now, period),
      trend: weeklyTrend(data.metric, TREND_WEEKS, now, this.config.timeZone),
      workload: await this.workload(employees, data.metric, now),
      atRisk: visibleOpen
        .filter((t) => !t.isOverdue && t.risk && t.risk.level !== 'LOW')
        .sort((a, b) => (b.risk?.score ?? 0) - (a.risk?.score ?? 0))
        .slice(0, LIST_LIMIT),
      overdue: visibleOpen
        .filter((t) => t.isOverdue)
        .sort((a, b) => b.delayDays - a.delayDays)
        .slice(0, LIST_LIMIT),
      blocked: visibleOpen.filter((t) => t.status === 'BLOCKED' || t.hasOpenBlocker),
      blockers: await this.blockerHotspots(where, now),
      delayReasons: await this.delayReasonStats(where, period.from),
      teams: teams.map((team) => {
        const ids = new Set(team.members.map((m) => m.id));
        const metric = data.metric.filter((t) => ids.has(t.primaryOwnerId));
        return { team: { id: team.id, name: team.name }, kpis: computeKpis(metric, ids.size, now, period) };
      }),
    };
  }

  /* ================================================================ organization / CEO (PRD §37–38) */

  async organization(ctx: AuthContext, now = new Date()): Promise<OrganizationDashboard> {
    if (ctx.scopes.report !== 'all') throw Errors.forbidden('داشبورد سازمانی فقط برای مدیریت ارشد در دسترس است.');
    const period = this.defaultPeriod(now);
    const trendSince = new Date(now.getTime() - TREND_WEEKS * 7 * DAY_MS);
    const data = await this.loadScope(ctx, {}, trendSince, now);
    const employees = await this.workloadEmployees({});
    const departments = await this.prisma.department.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, confidential: true },
    });
    const workload = await this.workload(employees, data.metric, now);
    const open = data.summaries.filter((t) => isOpenStatus(t.status));

    const departmentRows = departments.map((d) => {
      const metric = data.metric.filter((t) => t.departmentId === d.id);
      const headcount = employees.filter((e) => e.departmentId === d.id).length;
      return { department: d, kpis: computeKpis(metric, headcount, now, period) };
    });
    const departmentLoad = departments.map((d) => {
      const rows = workload.filter((w) => w.employee.departmentId === d.id);
      return {
        department: { id: d.id, name: d.name },
        headcount: rows.length,
        avgLoad: rows.length ? Math.round((rows.reduce((s, r) => s + r.load, 0) / rows.length) * 10) / 10 : 0,
      };
    });

    return {
      kpis: computeKpis(data.metric, employees.length, now, period),
      departments: departmentRows,
      critical: open
        .filter(
          (t) => t.priority === 'URGENT' || (t.isOverdue && t.priority === 'HIGH') || (t.isOverdue && t.delayDays >= 7),
        )
        .sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || b.delayDays - a.delayDays)
        .slice(0, LIST_LIMIT),
      overdue: open
        .filter((t) => t.isOverdue)
        .sort((a, b) => b.delayDays - a.delayDays)
        .slice(0, LIST_LIMIT),
      atRisk: open
        .filter((t) => !t.isOverdue && t.risk?.level === 'HIGH')
        .sort((a, b) => (b.risk?.score ?? 0) - (a.risk?.score ?? 0))
        .slice(0, LIST_LIMIT),
      bottlenecks: await this.blockerHotspots({}, now),
      delayReasons: await this.delayReasonStats({}, period.from),
      trend: weeklyTrend(data.metric, TREND_WEEKS, now, this.config.timeZone),
      workload: {
        overloaded: workload.filter((w) => w.state === 'OVERLOADED').slice(0, 10),
        underutilized: workload.filter((w) => w.state === 'UNDERUTILIZED').slice(0, 10),
        departmentLoad,
      },
    };
  }

  /** KPI set for an arbitrary filter — used by reports and AI summaries. */
  async kpisFor(
    where: Prisma.TaskWhereInput,
    employeeWhere: Prisma.EmployeeWhereInput,
    period: Period,
    now = new Date(),
  ): Promise<{ kpis: KpiSet; data: ScopeData }> {
    const data = await this.loadScope(null, where, period.from, now);
    const headcount = (await this.workloadEmployees(employeeWhere)).length;
    return { kpis: computeKpis(data.metric, headcount, now, period), data };
  }
}
