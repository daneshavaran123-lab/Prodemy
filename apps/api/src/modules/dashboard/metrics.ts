import {
  DAY_MS,
  PRIORITY_WEIGHT,
  addDaysToKey,
  delayDays,
  isOpenStatus,
  ratio,
  round,
  weekdayOfKey,
  zonedDateKey,
  zonedTimeToUtc,
  type KpiSet,
  type TaskPriority,
  type TaskStatus,
  type TrendPoint,
  type WorkloadRow,
  type WorkloadState,
  type EmployeeRef,
} from '@karban/shared';

/** Slim task facts used for every KPI computation. */
export interface MetricTask {
  id: string;
  status: TaskStatus;
  priority: TaskPriority;
  deadline: Date;
  createdAt: Date;
  completedAt: Date | null;
  cancelledAt: Date | null;
  primaryOwnerId: string;
  departmentId: string;
  riskLevel: string | null;
  reviewStatus: string;
  hasOpenBlocker: boolean;
}

export interface Period {
  from: Date;
  to: Date;
}

const isBlocked = (t: MetricTask) => isOpenStatus(t.status) && (t.status === 'BLOCKED' || t.hasOpenBlocker);
const isOverdue = (t: MetricTask, now: Date) => isOpenStatus(t.status) && t.deadline < now;
const inPeriod = (d: Date | null, p: Period) => !!d && d >= p.from && d <= p.to;

/**
 * Relative KPIs (PRD §36, §38). Departments differ greatly in size, so rates and
 * per-employee figures are reported alongside raw counts.
 */
export function computeKpis(tasks: MetricTask[], headcount: number, now: Date, period: Period): KpiSet {
  const active = tasks.filter((t) => isOpenStatus(t.status));
  const completed = tasks.filter((t) => t.status === 'COMPLETED' && inPeriod(t.completedAt, period));
  const completedOnTime = completed.filter((t) => t.completedAt! <= t.deadline);
  const overdue = active.filter((t) => t.deadline < now);
  const blocked = active.filter(isBlocked);
  const atRisk = active.filter((t) => t.deadline >= now && t.riskLevel === 'HIGH');
  const dueInPeriod = tasks.filter(
    (t) => t.status !== 'CANCELLED' && t.deadline >= period.from && t.deadline <= period.to && t.deadline <= now,
  );
  const dueCompleted = dueInPeriod.filter((t) => t.status === 'COMPLETED');
  const late = [
    ...completed.filter((t) => t.completedAt! > t.deadline).map((t) => delayDays(t.deadline, t.completedAt!)),
    ...overdue.map((t) => delayDays(t.deadline, now)),
  ];
  const ids = new Set([...active, ...completed].map((t) => t.id));
  return {
    headcount,
    total: ids.size,
    active: active.length,
    completed: completed.length,
    completedOnTime: completedOnTime.length,
    onTimeRate: ratio(completedOnTime.length, completed.length),
    completionRate: ratio(dueCompleted.length, dueInPeriod.length),
    overdue: overdue.length,
    overdueRate: ratio(overdue.length, active.length),
    avgDelayDays: late.length ? round(late.reduce((a, b) => a + b, 0) / late.length) : 0,
    blocked: blocked.length,
    blockedRate: ratio(blocked.length, active.length),
    atRisk: atRisk.length,
    riskRate: ratio(atRisk.length, active.length),
    tasksPerEmployee: headcount > 0 ? round(active.length / headcount) : null,
    pendingReview: tasks.filter((t) => t.status === 'COMPLETED' && t.reviewStatus === 'PENDING').length,
  };
}

/** Start (local Saturday 00:00) of the Iranian week containing `date`. */
export function weekStart(date: Date, timeZone: string): Date {
  const key = zonedDateKey(date, timeZone);
  const back = (weekdayOfKey(key) - 6 + 7) % 7;
  return zonedTimeToUtc(addDaysToKey(key, -back), 0, 0, timeZone);
}

/** Weekly buckets (oldest first) ending with the current week. */
export function weeklyTrend(tasks: MetricTask[], weeks: number, now: Date, timeZone: string): TrendPoint[] {
  const current = weekStart(now, timeZone);
  const points: TrendPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(current.getTime() - i * 7 * DAY_MS);
    const end = new Date(Math.min(start.getTime() + 7 * DAY_MS - 1, now.getTime()));
    const completed = tasks.filter((t) => t.completedAt && t.completedAt >= start && t.completedAt <= end);
    points.push({
      periodStart: start.toISOString(),
      created: tasks.filter((t) => t.createdAt >= start && t.createdAt <= end).length,
      completed: completed.length,
      completedOnTime: completed.filter((t) => t.completedAt! <= t.deadline).length,
      // Open-and-late at the end of the bucket, reconstructed from timestamps.
      overdueOpen: tasks.filter(
        (t) =>
          t.createdAt <= end &&
          t.deadline < end &&
          (!t.completedAt || t.completedAt > end) &&
          (!t.cancelledAt || t.cancelledAt > end),
      ).length,
    });
  }
  return points;
}

const MIN_ACTIVE_FOR_OVERLOAD = 3;
/** Group mean load of two normal-priority tasks per person. */
const MIN_MEAN_FOR_UNDERUSE = 4;

export interface WorkloadEmployee extends EmployeeRef {
  departmentName: string;
  onLeave: boolean;
}

/**
 * Workload per person (PRD §34, §55): priority-weighted open load compared to the
 * group mean. Flags are informational — the system never reassigns automatically.
 */
export function computeWorkload(
  employees: WorkloadEmployee[],
  tasks: MetricTask[],
  now: Date,
  thresholds: { overload: number; underutilized: number },
): WorkloadRow[] {
  const weekEnd = now.getTime() + 7 * DAY_MS;
  const rows = employees.map((e) => {
    const mine = tasks.filter((t) => t.primaryOwnerId === e.id && isOpenStatus(t.status));
    return {
      employee: e,
      active: mine.length,
      overdue: mine.filter((t) => isOverdue(t, now)).length,
      blocked: mine.filter(isBlocked).length,
      highPriority: mine.filter((t) => t.priority === 'HIGH' || t.priority === 'URGENT').length,
      dueThisWeek: mine.filter((t) => t.deadline >= now && t.deadline.getTime() <= weekEnd).length,
      load: mine.reduce((s, t) => s + PRIORITY_WEIGHT[t.priority], 0),
    };
  });
  const available = rows.filter((r) => !r.employee.onLeave);
  const mean = available.length ? available.reduce((s, r) => s + r.load, 0) / available.length : 0;
  return rows
    .map((r) => {
      const loadIndex = mean > 0 ? round(r.load / mean, 2) : null;
      let state: WorkloadState = 'BALANCED';
      // Relative flags need some absolute substance, so tiny groups don't produce noise.
      if (loadIndex !== null && !r.employee.onLeave) {
        if (loadIndex >= thresholds.overload && r.active >= MIN_ACTIVE_FOR_OVERLOAD) state = 'OVERLOADED';
        else if (loadIndex <= thresholds.underutilized && mean >= MIN_MEAN_FOR_UNDERUSE) state = 'UNDERUTILIZED';
      }
      return {
        employee: {
          id: r.employee.id,
          fullName: r.employee.fullName,
          jobTitle: r.employee.jobTitle,
          departmentId: r.employee.departmentId,
          departmentName: r.employee.departmentName,
        },
        active: r.active,
        overdue: r.overdue,
        blocked: r.blocked,
        highPriority: r.highPriority,
        dueThisWeek: r.dueThisWeek,
        load: r.load,
        loadIndex,
        state,
        onLeave: r.employee.onLeave,
      };
    })
    .sort((a, b) => b.load - a.load);
}

/** Coefficient of variation of load — a single "how uneven is distribution" number. */
export function loadDispersion(rows: WorkloadRow[]): number {
  const loads = rows.filter((r) => !r.onLeave).map((r) => r.load);
  if (loads.length < 2) return 0;
  const mean = loads.reduce((a, b) => a + b, 0) / loads.length;
  if (mean === 0) return 0;
  const variance = loads.reduce((s, l) => s + (l - mean) ** 2, 0) / loads.length;
  return round(Math.sqrt(variance) / mean, 2);
}

/** Weekly buckets covering [from, to] (max 53), for reports over arbitrary periods. */
export function trendBetween(tasks: MetricTask[], period: Period, timeZone: string): TrendPoint[] {
  const first = weekStart(period.from, timeZone).getTime();
  const weeks = Math.min(53, Math.max(1, Math.ceil((period.to.getTime() - first + 1) / (7 * DAY_MS))));
  return weeklyTrend(tasks, weeks, period.to, timeZone);
}
