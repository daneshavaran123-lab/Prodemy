import { Injectable } from '@nestjs/common';
import { Prisma, RecurrenceFrequency, TaskPriority } from '@prisma/client';
import type { RecurrenceDto } from '@karban/shared';
import { timeZoneOffsetMinutes } from '@karban/shared';
import { PrismaService, type Db } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { InjectConfig } from '../../config/config.module';
import type { AppConfig } from '../../config/config';
import type { AuthContext } from '../../common/auth-context';
import { Errors } from '../../common/errors';
import { departmentRefSelect, employeeRefSelect, iso, toEmployeeRef } from '../../common/serializers';
import { TaskPolicy } from '../access/access-policy';
import { nextOccurrence, type Calendar } from './recurrence.rules';

export interface CreateRuleInput {
  title: string;
  description: string;
  creatorId: string;
  departmentId: string;
  primaryOwnerId: string;
  managerId: string;
  collaboratorIds: string[];
  priority: TaskPriority;
  category?: string | null;
  tags: string[];
  projectId?: string | null;
  estimatedEffortHours?: number | null;
  confidential: boolean;
  requiresReview: boolean;
  deadline: Date;
  frequency: RecurrenceFrequency;
  interval: number;
  weekdays: number[];
  dayOfMonth: number | null;
  durationDays: number;
  startDate: string;
  endDate: string | null;
}

const ruleInclude = {
  primaryOwner: { select: employeeRefSelect },
  manager: { select: employeeRefSelect },
  department: { select: departmentRefSelect },
  _count: { select: { tasks: true } },
} satisfies Prisma.RecurrenceRuleInclude;

/** Recurring task templates (PRD §26). Instances are produced by the scheduler. */
@Injectable()
export class RecurrenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  async calendar(): Promise<Calendar> {
    const s = await this.settings.get();
    return { timeZone: this.config.timeZone, workingDays: s.workingDays, holidays: s.holidays };
  }

  /** Minutes after local midnight of the given instant. */
  localMinutes(date: Date): number {
    const offset = timeZoneOffsetMinutes(date, this.config.timeZone);
    const minutes = Math.floor((date.getTime() / 60000 + offset) % 1440);
    return (minutes + 1440) % 1440;
  }

  async createRule(tx: Db, input: CreateRuleInput) {
    if (input.frequency === RecurrenceFrequency.WEEKLY && input.weekdays.length === 0) {
      throw Errors.validation('برای تکرار هفتگی، حداقل یک روز هفته را انتخاب کنید.');
    }
    if (input.endDate && input.endDate < input.startDate) {
      throw Errors.validation('تاریخ پایان تکرار نمی‌تواند قبل از تاریخ شروع باشد.');
    }
    const rule = {
      frequency: input.frequency,
      interval: input.interval,
      weekdays: input.weekdays,
      dayOfMonth: input.dayOfMonth,
      startDate: input.startDate,
      endDate: input.endDate,
    };
    // The first instance is the task being created now; the rule waits for the next one.
    const next = nextOccurrence(rule, input.startDate, await this.calendar());
    return tx.recurrenceRule.create({
      data: {
        title: input.title,
        description: input.description,
        departmentId: input.departmentId,
        primaryOwnerId: input.primaryOwnerId,
        managerId: input.managerId,
        creatorId: input.creatorId,
        collaboratorIds: input.collaboratorIds,
        priority: input.priority,
        category: input.category ?? null,
        tags: input.tags,
        projectId: input.projectId ?? null,
        estimatedEffortHours: input.estimatedEffortHours ?? null,
        confidential: input.confidential,
        requiresReview: input.requiresReview,
        ...rule,
        durationDays: input.durationDays,
        deadlineMinutes: this.localMinutes(input.deadline),
        nextOccurrence: next,
        lastRunAt: new Date(),
        active: next !== null,
      },
    });
  }

  private canManageRule(
    ctx: AuthContext,
    r: { creatorId: string; managerId: string; primaryOwnerId: string; departmentId: string; confidential: boolean },
  ) {
    return TaskPolicy.canManage(ctx, {
      id: '',
      departmentId: r.departmentId,
      primaryOwnerId: r.primaryOwnerId,
      managerId: r.managerId,
      creatorId: r.creatorId,
      confidential: r.confidential,
      status: 'IN_PROGRESS',
      reviewStatus: 'NONE',
      participantIds: [r.primaryOwnerId],
    });
  }

  async list(ctx: AuthContext): Promise<RecurrenceDto[]> {
    const rows = await this.prisma.recurrenceRule.findMany({
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
      include: ruleInclude,
    });
    return rows
      .filter((r) => r.primaryOwnerId === ctx.employeeId || this.canManageRule(ctx, r))
      .map((r) => this.toDto(r));
  }

  async update(
    ctx: AuthContext,
    id: string,
    dto: { active?: boolean; endDate?: string | null; title?: string; description?: string; priority?: TaskPriority },
  ): Promise<RecurrenceDto> {
    const rule = await this.prisma.recurrenceRule.findUnique({ where: { id } });
    if (!rule) throw Errors.notFound('الگوی تکرار');
    if (!this.canManageRule(ctx, rule)) throw Errors.forbidden('فقط مدیر وظیفه می‌تواند الگوی تکرار را تغییر دهد.');
    let nextKey = rule.nextOccurrence;
    if (dto.active === true && !rule.active) {
      // Resuming: continue from today rather than back-filling the paused period.
      const cal = await this.calendar();
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: cal.timeZone }).format(new Date());
      nextKey = nextOccurrence({ ...rule, endDate: dto.endDate ?? rule.endDate }, today, cal);
    }
    await this.prisma.recurrenceRule.update({
      where: { id },
      data: {
        active: dto.active !== undefined ? dto.active && nextKey !== null : undefined,
        endDate: dto.endDate,
        title: dto.title,
        description: dto.description,
        priority: dto.priority,
        nextOccurrence: nextKey,
      },
    });
    const row = await this.prisma.recurrenceRule.findUniqueOrThrow({ where: { id }, include: ruleInclude });
    return this.toDto(row);
  }

  toDto(r: Prisma.RecurrenceRuleGetPayload<{ include: typeof ruleInclude }>): RecurrenceDto {
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      priority: r.priority,
      frequency: r.frequency,
      interval: r.interval,
      weekdays: r.weekdays,
      dayOfMonth: r.dayOfMonth,
      active: r.active,
      nextRunAt: r.nextOccurrence,
      endDate: r.endDate,
      durationDays: r.durationDays,
      primaryOwner: toEmployeeRef(r.primaryOwner)!,
      manager: toEmployeeRef(r.manager)!,
      department: r.department,
      startDate: r.startDate,
      lastRunAt: iso(r.lastRunAt),
      instanceCount: r._count.tasks,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
