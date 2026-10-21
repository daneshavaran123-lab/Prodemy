import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import {
  DAY_MS,
  RISK_LEVEL_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type KpiSet,
  type ReportResponse,
  type TaskPriority,
} from '@karban/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { TasksService } from '../tasks/tasks.service';
import { InjectConfig } from '../../config/config.module';
import type { AppConfig } from '../../config/config';
import type { AuthContext } from '../../common/auth-context';
import { Errors } from '../../common/errors';
import { formatJalali } from '../../common/utils/jalali';
import { EXPORT_MIME, toCsv, toXlsx, type Cell } from '../../common/utils/export';
import { TaskPolicy, scopeAtLeast } from '../access/access-policy';
import { computeKpis, trendBetween, type Period } from '../dashboard/metrics';
import { taskSummaryInclude, toTaskSummary } from '../tasks/task.mapper';
import type { ListTasksQuery } from '../tasks/tasks.dto';

export type ReportScope = 'employee' | 'team' | 'department' | 'organization';
export type ExportFormat = 'csv' | 'xlsx';

const pct = (v: number | null) => (v === null ? '' : `${Math.round(v * 100)}%`);
const MAX_EXPORT_ROWS = 5000;

/** Reports (PRD §116) and exports (PRD §117). Reports contain metrics, never task content. */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboard: DashboardService,
    private readonly tasks: TasksService,
    private readonly audit: AuditService,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  resolvePeriod(from?: Date, to?: Date): Period {
    const end = to ?? new Date();
    const start = from ?? new Date(end.getTime() - 30 * DAY_MS);
    if (start > end) throw Errors.validation('بازه زمانی نامعتبر است.');
    if (end.getTime() - start.getTime() > 400 * DAY_MS) throw Errors.validation('حداکثر بازه گزارش یک سال است.');
    return { from: start, to: end };
  }

  async summary(ctx: AuthContext, scope: ReportScope, id: string | undefined, period: Period): Promise<ReportResponse> {
    const now = new Date();
    const range = { from: period.from.toISOString(), to: period.to.toISOString() };
    const tz = this.config.timeZone;

    if (scope === 'organization') {
      if (ctx.scopes.report !== 'all') throw Errors.forbidden();
      const { kpis, data } = await this.dashboard.kpisFor({}, {}, period, now);
      const departments = await this.prisma.department.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { name: 'asc' },
      });
      const employees = await this.dashboard.workloadEmployees({});
      return {
        scope: { type: scope, id: null, label: 'کل سازمان' },
        period: range,
        kpis,
        trend: trendBetween(data.metric, period, tz),
        delayReasons: await this.dashboard.delayReasonStats({}, period.from),
        breakdown: departments.map((d) => ({
          key: d.id,
          label: d.name,
          kpis: computeKpis(
            data.metric.filter((t) => t.departmentId === d.id),
            employees.filter((e) => e.departmentId === d.id).length,
            now,
            period,
          ),
        })),
      };
    }

    if (scope === 'department') {
      if (!id) throw Errors.validation('شناسه دپارتمان الزامی است.');
      this.dashboard.assertDepartmentAccess(ctx, id);
      const dept = await this.prisma.department.findUnique({ where: { id } });
      if (!dept) throw Errors.notFound('دپارتمان');
      const where = { departmentId: id };
      const { kpis, data } = await this.dashboard.kpisFor(where, { departmentId: id }, period, now);
      const employees = await this.dashboard.workloadEmployees({ departmentId: id });
      return {
        scope: { type: scope, id, label: dept.name },
        period: range,
        kpis,
        trend: trendBetween(data.metric, period, tz),
        delayReasons: await this.dashboard.delayReasonStats(where, period.from),
        breakdown: employees.map((e) => ({
          key: e.id,
          label: e.fullName,
          kpis: computeKpis(
            data.metric.filter((t) => t.primaryOwnerId === e.id),
            1,
            now,
            period,
          ),
        })),
      };
    }

    if (scope === 'team') {
      if (!id) throw Errors.validation('شناسه تیم الزامی است.');
      const team = await this.prisma.team.findUnique({ where: { id }, include: { members: { select: { id: true } } } });
      if (!team) throw Errors.notFound('تیم');
      const allowed =
        ctx.ledTeamIds.includes(id) ||
        ctx.scopes.report === 'all' ||
        (scopeAtLeast(ctx.scopes.report, 'department') && ctx.departmentScopeIds.includes(team.departmentId));
      if (!allowed) throw Errors.forbidden('شما به گزارش این تیم دسترسی ندارید.');
      const memberIds = team.members.map((m) => m.id);
      const where = { primaryOwnerId: { in: memberIds } };
      const { kpis, data } = await this.dashboard.kpisFor(where, { id: { in: memberIds } }, period, now);
      const employees = await this.dashboard.workloadEmployees({ id: { in: memberIds } });
      return {
        scope: { type: scope, id, label: team.name },
        period: range,
        kpis,
        trend: trendBetween(data.metric, period, tz),
        delayReasons: await this.dashboard.delayReasonStats(where, period.from),
        breakdown: employees.map((e) => ({
          key: e.id,
          label: e.fullName,
          kpis: computeKpis(
            data.metric.filter((t) => t.primaryOwnerId === e.id),
            1,
            now,
            period,
          ),
        })),
      };
    }

    // employee
    const employeeId = id ?? ctx.employeeId;
    await this.assertEmployeeAccess(ctx, employeeId);
    const employee = await this.prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    const where = { primaryOwnerId: employeeId };
    const { kpis, data } = await this.dashboard.kpisFor(where, { id: employeeId }, period, now);
    return {
      scope: { type: 'employee', id: employeeId, label: employee.fullName },
      period: range,
      kpis,
      trend: trendBetween(data.metric, period, tz),
      delayReasons: await this.dashboard.delayReasonStats(where, period.from),
      breakdown: (['URGENT', 'HIGH', 'NORMAL', 'LOW'] as TaskPriority[]).map((p) => ({
        key: p,
        label: `اولویت ${TASK_PRIORITY_LABELS[p]}`,
        kpis: computeKpis(
          data.metric.filter((t) => t.priority === p),
          1,
          now,
          period,
        ),
      })),
    };
  }

  async assertEmployeeAccess(ctx: AuthContext, employeeId: string) {
    if (employeeId === ctx.employeeId) return;
    const visible = await this.prisma.employee.count({
      where: { AND: [{ id: employeeId }, TaskPolicy.visibleEmployeesWhere(ctx, ctx.scopes.report)] },
    });
    if (!visible) throw Errors.forbidden('شما به گزارش این کارمند دسترسی ندارید.');
  }

  /* ------------------------------------------------------------ exports */

  async exportTasks(ctx: AuthContext, q: ListTasksQuery, format: ExportFormat) {
    const where = this.tasks.buildWhere(ctx, q);
    const rows = await this.prisma.task.findMany({
      where,
      include: { ...taskSummaryInclude, creator: { select: { fullName: true } } },
      orderBy: [{ deadline: 'asc' }],
      take: MAX_EXPORT_ROWS,
    });
    const tz = this.config.timeZone;
    const now = new Date();
    const headers = [
      'کد',
      'عنوان',
      'دپارتمان',
      'مسئول اصلی',
      'همکاران',
      'مدیر وظیفه',
      'ایجادکننده',
      'وضعیت',
      'اولویت',
      'پیشرفت',
      'تاریخ شروع',
      'مهلت',
      'تاریخ تکمیل',
      'عقب‌افتاده',
      'روز تأخیر',
      'ریسک',
      'دسته‌بندی',
      'برچسب‌ها',
      'پروژه',
    ];
    const data: Cell[][] = rows.map((r) => {
      const t = toTaskSummary(r, now);
      return [
        t.code,
        t.title,
        t.department.name,
        t.primaryOwner.fullName,
        t.collaborators.map((c) => c.fullName).join('، '),
        t.manager.fullName,
        r.creator.fullName,
        TASK_STATUS_LABELS[t.status],
        TASK_PRIORITY_LABELS[t.priority],
        `${t.progress}%`,
        formatJalali(r.startDate, tz),
        formatJalali(r.deadline, tz, { withTime: true }),
        r.completedAt ? formatJalali(r.completedAt, tz) : '',
        t.isOverdue ? 'بله' : 'خیر',
        t.delayDays,
        t.risk ? RISK_LEVEL_LABELS[t.risk.level] : '',
        t.category ?? '',
        t.tags.join('، '),
        t.project?.name ?? '',
      ];
    });
    await this.audit.logFor(ctx, {
      action: AuditAction.DATA_EXPORTED,
      entityType: 'Task',
      metadata: { format, rows: data.length, filters: q as unknown as Prisma.InputJsonValue },
    });
    return this.file('karban-tasks', format, 'وظایف', headers, data);
  }

  async exportSummary(
    ctx: AuthContext,
    scope: ReportScope,
    id: string | undefined,
    period: Period,
    format: ExportFormat,
  ) {
    const report = await this.summary(ctx, scope, id, period);
    const headers = [
      'عنوان',
      'تعداد نفرات',
      'فعال',
      'تکمیل‌شده',
      'تکمیل به‌موقع',
      'نرخ به‌موقع',
      'نرخ تکمیل',
      'عقب‌افتاده',
      'نرخ تأخیر',
      'میانگین تأخیر (روز)',
      'مسدود',
      'در معرض ریسک',
      'وظیفه فعال به ازای هر نفر',
    ];
    const line = (label: string, k: KpiSet): Cell[] => [
      label,
      k.headcount,
      k.active,
      k.completed,
      k.completedOnTime,
      pct(k.onTimeRate),
      pct(k.completionRate),
      k.overdue,
      pct(k.overdueRate),
      k.avgDelayDays,
      k.blocked,
      k.atRisk,
      k.tasksPerEmployee ?? '',
    ];
    const rows = [
      line(`مجموع — ${report.scope.label}`, report.kpis),
      ...report.breakdown.map((b) => line(b.label, b.kpis)),
    ];
    await this.audit.logFor(ctx, {
      action: AuditAction.DATA_EXPORTED,
      entityType: 'Report',
      entityId: id,
      metadata: { scope, format, from: report.period.from, to: report.period.to },
    });
    return this.file(`karban-report-${scope}`, format, 'گزارش', headers, rows);
  }

  private async file(base: string, format: ExportFormat, sheet: string, headers: string[], rows: Cell[][]) {
    const stamp = new Date().toISOString().slice(0, 10);
    const buffer = format === 'xlsx' ? await toXlsx(sheet, headers, rows) : toCsv(headers, rows);
    return { buffer, fileName: `${base}-${stamp}.${format}`, mimeType: EXPORT_MIME[format] };
  }
}
