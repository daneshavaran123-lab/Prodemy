import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import type { SystemSettings } from '@karban/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../../common/auth-context';

const KEY = 'system';

/**
 * Defaults for the PRD's "Needs Validation" items (§136). All are admin-editable.
 * Working days use JS weekday numbers: Saturday (6) … Thursday (4); Friday off.
 */
export const DEFAULT_SETTINGS: SystemSettings = {
  reminderOffsetsDays: [-3, -1, 0, 1, 3],
  workingDays: [6, 0, 1, 2, 3, 4],
  holidays: [],
  attachmentMaxMb: 20,
  registrationRequiresApproval: true,
  staleTaskDays: 3,
  digestHour: 8,
  weeklySummaryDay: 6,
  weeklySummaryHour: 8,
  overloadThreshold: 1.5,
  underutilizedThreshold: 0.5,
  telegramBotUsername: null,
};

const CACHE_MS = 30_000;

@Injectable()
export class SettingsService {
  private cache: { value: SystemSettings; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<SystemSettings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const row = await this.prisma.systemSetting.findUnique({ where: { key: KEY } });
    const value = { ...DEFAULT_SETTINGS, ...((row?.value as Partial<SystemSettings>) ?? {}) };
    this.cache = { value, at: Date.now() };
    return value;
  }

  async update(ctx: AuthContext, patch: Partial<SystemSettings>): Promise<SystemSettings> {
    const current = await this.get();
    const next: SystemSettings = { ...current, ...stripUndefined(patch) };
    next.reminderOffsetsDays = [...new Set(next.reminderOffsetsDays)].sort((a, b) => a - b);
    next.workingDays = [...new Set(next.workingDays)].sort();
    next.holidays = [...new Set(next.holidays)].sort();
    await this.prisma.systemSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.userId },
      update: { value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.userId },
    });
    this.cache = null;
    const changed = Object.keys(patch).filter(
      (k) => JSON.stringify((current as any)[k]) !== JSON.stringify((next as any)[k]),
    );
    await this.audit.logFor(ctx, {
      action: AuditAction.SETTINGS_CHANGED,
      entityType: 'SystemSetting',
      entityId: KEY,
      metadata: { changed, before: pick(current, changed), after: pick(next, changed) },
    });
    return next;
  }

  invalidate() {
    this.cache = null;
  }
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function pick(obj: object, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, (obj as any)[k]]));
}
