import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { EmploymentStatus, Prisma, TaskStatus } from '@prisma/client';
import { OPEN_TASK_STATUSES, workingDaysUntil, DAY_MS } from '@karban/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { InjectConfig } from '../../config/config.module';
import type { AppConfig } from '../../config/config';
import { assessRisk } from './risk.engine';

const OPEN = OPEN_TASK_STATUSES as TaskStatus[];
const HISTORY_WINDOW_DAYS = 90;

/**
 * Computes and persists explainable risk for open tasks. Runs after every task
 * mutation (single task) and from the scheduler (all open tasks).
 */
@Injectable()
export class RiskService {
  private readonly logger = new Logger(RiskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  /** Re-assesses the given tasks (or every open task) and returns how many changed. */
  async refresh(taskIds?: string[], now = new Date()): Promise<number> {
    const tasks = await this.prisma.task.findMany({
      where: taskIds ? { id: { in: taskIds } } : { status: { in: OPEN } },
      select: {
        id: true,
        status: true,
        priority: true,
        progress: true,
        startDate: true,
        deadline: true,
        createdAt: true,
        lastProgressAt: true,
        primaryOwnerId: true,
        riskLevel: true,
        riskScore: true,
        riskFactors: true,
        primaryOwner: { select: { departmentId: true, employmentStatus: true } },
        blockers: { where: { status: 'OPEN' }, select: { id: true } },
      },
    });
    if (!tasks.length) return 0;

    const settings = await this.settings.get();
    const ownerIds = [...new Set(tasks.map((t) => t.primaryOwnerId))];
    const departmentIds = [...new Set(tasks.map((t) => t.primaryOwner.departmentId))];

    const [ownerActive, deptActive, deptHeadcount, history] = await Promise.all([
      this.prisma.task.groupBy({
        by: ['primaryOwnerId'],
        where: { status: { in: OPEN }, primaryOwnerId: { in: ownerIds } },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<Array<{ departmentId: string; count: bigint }>>`
        SELECT e."departmentId" AS "departmentId", count(t.id) AS count
        FROM "Task" t JOIN "Employee" e ON e.id = t."primaryOwnerId"
        WHERE t.status::text = ANY(${OPEN as string[]}) AND e."departmentId"::text = ANY(${departmentIds})
        GROUP BY e."departmentId"`,
      this.prisma.employee.groupBy({
        by: ['departmentId'],
        where: {
          departmentId: { in: departmentIds },
          employmentStatus: { not: EmploymentStatus.TERMINATED },
        },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<Array<{ ownerId: string; total: bigint; late: bigint }>>`
        SELECT "primaryOwnerId" AS "ownerId", count(*) AS total,
               count(*) FILTER (WHERE "completedAt" > deadline) AS late
        FROM "Task"
        WHERE status = 'COMPLETED' AND "completedAt" >= ${new Date(now.getTime() - HISTORY_WINDOW_DAYS * DAY_MS)}
          AND "primaryOwnerId"::text = ANY(${ownerIds})
        GROUP BY "primaryOwnerId"`,
    ]);

    const activeByOwner = new Map(ownerActive.map((r) => [r.primaryOwnerId, r._count._all]));
    const headcount = new Map(deptHeadcount.map((r) => [r.departmentId, r._count._all]));
    const avgByDept = new Map(
      deptActive.map((r) => [r.departmentId, Number(r.count) / Math.max(headcount.get(r.departmentId) ?? 1, 1)]),
    );
    const historyByOwner = new Map(history.map((r) => [r.ownerId, { total: Number(r.total), late: Number(r.late) }]));

    let changed = 0;
    for (const t of tasks) {
      const h = historyByOwner.get(t.primaryOwnerId);
      const assessment = assessRisk({
        now,
        status: t.status,
        priority: t.priority,
        progress: t.progress,
        startDate: t.startDate,
        deadline: t.deadline,
        createdAt: t.createdAt,
        lastProgressAt: t.lastProgressAt,
        hasOpenBlocker: t.blockers.length > 0,
        workingDaysLeft: workingDaysUntil(
          now,
          t.deadline,
          settings.workingDays,
          settings.holidays,
          this.config.timeZone,
        ),
        ownerActiveTasks: activeByOwner.get(t.primaryOwnerId) ?? 0,
        groupAvgActiveTasks: avgByDept.get(t.primaryOwner.departmentId) ?? 0,
        ownerLateRate: h && h.total > 0 ? h.late / h.total : null,
        ownerHistorySample: h?.total ?? 0,
        ownerOnLeave: t.primaryOwner.employmentStatus === EmploymentStatus.ON_LEAVE,
        staleDays: settings.staleTaskDays,
      });
      const nextFactors = assessment?.factors ?? null;
      const same =
        (assessment?.level ?? null) === t.riskLevel &&
        (assessment?.score ?? null) === t.riskScore &&
        JSON.stringify(nextFactors) === JSON.stringify(t.riskFactors ?? null);
      if (same) continue;
      await this.prisma.task.update({
        where: { id: t.id },
        data: {
          riskLevel: assessment?.level ?? null,
          riskScore: assessment?.score ?? null,
          riskFactors: nextFactors ? (nextFactors as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          riskAssessedAt: now,
        },
      });
      changed++;
    }
    if (!taskIds) this.logger.debug(`Risk refreshed for ${tasks.length} tasks (${changed} changed)`);
    return changed;
  }

  /** Fire-and-forget refresh used after mutations; never fails the request. */
  refreshQuietly(taskIds: string[]) {
    this.refresh(taskIds).catch((err) => this.logger.warn(`Risk refresh failed: ${(err as Error).message}`));
  }
}

@Global()
@Module({ providers: [RiskService], exports: [RiskService] })
export class RiskModule {}
