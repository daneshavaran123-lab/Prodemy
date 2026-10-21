import { Injectable } from '@nestjs/common';
import { AuditAction, EmploymentStatus, Prisma, TaskStatus } from '@prisma/client';
import { OPEN_TASK_STATUSES, delayDays, ratio, round, zonedTimeToUtc, type PerformanceMetricRow } from '@karban/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InjectConfig } from '../../config/config.module';
import type { AppConfig } from '../../config/config';
import type { AuthContext } from '../../common/auth-context';
import { Errors } from '../../common/errors';
import { currentJalaliPeriod, jalaliMonthKeys } from '../../common/utils/jalali';
import { EXPORT_MIME, toCsv, toXlsx, type Cell } from '../../common/utils/export';

const OPEN = OPEN_TASK_STATUSES as TaskStatus[];

/** Metric codes stored in PerformanceIntegrationRecord (stable contract for integrations). */
export const PERFORMANCE_METRICS = [
  'total_tasks',
  'completed_tasks',
  'completed_on_time',
  'overdue_tasks',
  'completion_rate',
  'on_time_rate',
  'avg_delay_days',
  'active_workload',
  'blocked_tasks',
  'update_rate',
] as const;

/**
 * Performance-ready raw operational data (PRD §60–62, tech stack §16–19).
 * Produces facts such as "on-time completion = 88%", never an evaluation like "Good":
 * any rating belongs to a future, human-reviewed Performance module.
 * Contains no task titles or descriptions, so HR never sees confidential task content.
 */
@Injectable()
export class PerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  resolvePeriod(period?: string): { label: string; from: Date; to: Date } {
    const label = period ?? currentJalaliPeriod(new Date(), this.config.timeZone);
    let keys: { start: string; end: string };
    try {
      keys = jalaliMonthKeys(label, this.config.timeZone);
    } catch {
      throw Errors.validation('دوره باید به شکل سال-ماه شمسی باشد، مثلاً 1405-07.');
    }
    return {
      label,
      from: zonedTimeToUtc(keys.start, 0, 0, this.config.timeZone),
      to: new Date(zonedTimeToUtc(keys.end, 0, 0, this.config.timeZone).getTime() - 1),
    };
  }

  async metrics(period?: string, departmentId?: string): Promise<PerformanceMetricRow[]> {
    const p = this.resolvePeriod(period);
    const now = new Date();
    const reference = p.to < now ? p.to : now;
    const employees = await this.prisma.employee.findMany({
      where: { departmentId, employmentStatus: { not: EmploymentStatus.TERMINATED } },
      include: { department: { select: { id: true, name: true } } },
      orderBy: [{ department: { name: 'asc' } }, { fullName: 'asc' }],
    });
    const ids = employees.map((e) => e.id);
    const tasks = await this.prisma.task.findMany({
      where: {
        primaryOwnerId: { in: ids },
        status: { not: TaskStatus.CANCELLED },
        createdAt: { lte: p.to },
        OR: [
          { deadline: { gte: p.from, lte: p.to } },
          { completedAt: { gte: p.from, lte: p.to } },
          { status: { in: OPEN } },
        ],
      },
      select: {
        id: true,
        primaryOwnerId: true,
        status: true,
        deadline: true,
        completedAt: true,
        lastProgressAt: true,
        blockers: { where: { status: 'OPEN' }, select: { id: true } },
      },
    });
    const byOwner = new Map<string, typeof tasks>();
    for (const t of tasks) {
      const list = byOwner.get(t.primaryOwnerId) ?? [];
      list.push(t);
      byOwner.set(t.primaryOwnerId, list);
    }
    return employees.map((e) => {
      const mine = byOwner.get(e.id) ?? [];
      const inPeriod = mine.filter(
        (t) =>
          (t.deadline >= p.from && t.deadline <= p.to) ||
          (t.completedAt && t.completedAt >= p.from && t.completedAt <= p.to),
      );
      const completed = inPeriod.filter(
        (t) => t.status === TaskStatus.COMPLETED && t.completedAt && t.completedAt <= p.to,
      );
      const onTime = completed.filter((t) => t.completedAt! <= t.deadline);
      const overdue = inPeriod.filter(
        (t) =>
          t.deadline < reference && (!t.completedAt || t.completedAt > reference) && t.status !== TaskStatus.COMPLETED,
      );
      const lateDelays = [
        ...completed.filter((t) => t.completedAt! > t.deadline).map((t) => delayDays(t.deadline, t.completedAt!)),
        ...overdue.map((t) => delayDays(t.deadline, reference)),
      ];
      const open = mine.filter((t) => OPEN.includes(t.status));
      const updated = open.filter((t) => t.lastProgressAt >= p.from);
      return {
        employee: { id: e.id, employeeCode: e.employeeCode, fullName: e.fullName, jobTitle: e.jobTitle },
        department: e.department,
        period: p.label,
        totalTasks: inPeriod.length,
        completedTasks: completed.length,
        completedOnTime: onTime.length,
        overdueTasks: overdue.length,
        completionRate: ratio(completed.length, inPeriod.length),
        onTimeRate: ratio(onTime.length, completed.length),
        avgDelayDays: lateDelays.length ? round(lateDelays.reduce((a, b) => a + b, 0) / lateDelays.length) : 0,
        activeWorkload: open.length,
        blockedTasks: open.filter((t) => t.status === TaskStatus.BLOCKED || t.blockers.length > 0).length,
        updateRate: ratio(updated.length, open.length),
      };
    });
  }

  async export(ctx: AuthContext, period: string | undefined, departmentId: string | undefined, format: 'csv' | 'xlsx') {
    const rows = await this.metrics(period, departmentId);
    const pct = (v: number | null) => (v === null ? '' : round(v * 100));
    const headers = [
      'کد پرسنلی',
      'نام',
      'سمت',
      'دپارتمان',
      'دوره',
      'کل وظایف دوره',
      'تکمیل‌شده',
      'تکمیل به‌موقع',
      'عقب‌افتاده',
      'نرخ تکمیل (٪)',
      'نرخ به‌موقع (٪)',
      'میانگین تأخیر (روز)',
      'وظایف فعال',
      'وظایف مسدود',
      'نرخ به‌روزرسانی (٪)',
    ];
    const data: Cell[][] = rows.map((r) => [
      r.employee.employeeCode,
      r.employee.fullName,
      r.employee.jobTitle ?? '',
      r.department.name,
      r.period,
      r.totalTasks,
      r.completedTasks,
      r.completedOnTime,
      r.overdueTasks,
      pct(r.completionRate),
      pct(r.onTimeRate),
      r.avgDelayDays,
      r.activeWorkload,
      r.blockedTasks,
      pct(r.updateRate),
    ]);
    await this.audit.logFor(ctx, {
      action: AuditAction.DATA_EXPORTED,
      entityType: 'PerformanceMetrics',
      metadata: {
        period: rows[0]?.period ?? period ?? null,
        departmentId: departmentId ?? null,
        format,
        rows: data.length,
      },
    });
    const name = `karban-performance-${rows[0]?.period ?? period ?? 'current'}.${format}`;
    const buffer = format === 'xlsx' ? await toXlsx('داده عملکردی', headers, data) : toCsv(headers, data);
    return { buffer, fileName: name, mimeType: EXPORT_MIME[format] };
  }

  /** Persists a monthly snapshot for future Performance systems (REST/CSV integration). */
  async snapshot(period?: string): Promise<{ period: string; records: number }> {
    const rows = await this.metrics(period);
    const label = rows[0]?.period ?? this.resolvePeriod(period).label;
    const records: Prisma.PerformanceIntegrationRecordCreateManyInput[] = [];
    for (const r of rows) {
      const values: Record<(typeof PERFORMANCE_METRICS)[number], number | null> = {
        total_tasks: r.totalTasks,
        completed_tasks: r.completedTasks,
        completed_on_time: r.completedOnTime,
        overdue_tasks: r.overdueTasks,
        completion_rate: r.completionRate,
        on_time_rate: r.onTimeRate,
        avg_delay_days: r.avgDelayDays,
        active_workload: r.activeWorkload,
        blocked_tasks: r.blockedTasks,
        update_rate: r.updateRate,
      };
      for (const [metric, value] of Object.entries(values)) {
        if (value === null) continue;
        records.push({ employeeId: r.employee.id, departmentId: r.department.id, metric, value, period: label });
      }
    }
    await this.prisma.$transaction([
      this.prisma.performanceIntegrationRecord.deleteMany({ where: { period: label } }),
      this.prisma.performanceIntegrationRecord.createMany({ data: records }),
    ]);
    return { period: label, records: records.length };
  }

  async records(period?: string, employeeId?: string) {
    const label = period ?? currentJalaliPeriod(new Date(), this.config.timeZone, -1);
    const rows = await this.prisma.performanceIntegrationRecord.findMany({
      where: { period: label, employeeId },
      include: { employee: { select: { employeeCode: true, fullName: true } } },
      orderBy: [{ employeeId: 'asc' }, { metric: 'asc' }],
    });
    return rows.map((r) => ({
      employeeId: r.employeeId,
      employeeCode: r.employee.employeeCode,
      fullName: r.employee.fullName,
      departmentId: r.departmentId,
      metric: r.metric,
      value: r.value,
      period: r.period,
      generatedAt: r.generatedAt.toISOString(),
    }));
  }
}
