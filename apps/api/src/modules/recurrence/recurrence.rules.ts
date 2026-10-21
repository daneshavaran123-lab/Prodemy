import { addDaysToKey, diffDateKeys, weekdayOfKey, zonedTimeToUtc } from '@karban/shared';
import { jalaliParts } from '../../common/utils/jalali';

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';

export interface RuleShape {
  frequency: Frequency;
  interval: number;
  weekdays: number[];
  dayOfMonth: number | null;
  startDate: string;
  endDate: string | null;
}

export interface Calendar {
  timeZone: string;
  workingDays: readonly number[];
  holidays: readonly string[];
}

/** Iranian weeks start on Saturday (6). */
function weekStartKey(key: string): string {
  const offset = (weekdayOfKey(key) - 6 + 7) % 7;
  return addDaysToKey(key, -offset);
}

function jalaliOfKey(key: string, timeZone: string) {
  return jalaliParts(zonedTimeToUtc(key, 12, 0, timeZone), timeZone);
}

function isWorkingDay(key: string, cal: Calendar) {
  return cal.workingDays.includes(weekdayOfKey(key)) && !cal.holidays.includes(key);
}

/**
 * The first occurrence strictly after `afterKey` (local YYYY-MM-DD), or null when the
 * rule has ended. Frequencies (PRD §26):
 * - DAILY   → every working day (skips weekends/holidays from settings)
 * - CUSTOM  → every `interval` days
 * - WEEKLY  → chosen weekdays, every `interval` weeks
 * - MONTHLY → `dayOfMonth` of the Jalali month, every `interval` months
 */
export function nextOccurrence(rule: RuleShape, afterKey: string, cal: Calendar): string | null {
  const interval = Math.max(1, rule.interval);
  const within = (key: string) => !rule.endDate || key <= rule.endDate;
  const from = afterKey < rule.startDate ? addDaysToKey(rule.startDate, -1) : afterKey;

  switch (rule.frequency) {
    case 'CUSTOM': {
      const elapsed = diffDateKeys(rule.startDate, from);
      const steps = Math.floor(elapsed / interval) + 1;
      const key = addDaysToKey(rule.startDate, Math.max(steps, 0) * interval);
      return within(key) ? key : null;
    }
    case 'DAILY': {
      for (let i = 1; i <= 60; i++) {
        const key = addDaysToKey(from, i);
        if (!within(key)) return null;
        if (isWorkingDay(key, cal)) return key;
      }
      return null;
    }
    case 'WEEKLY': {
      const days = rule.weekdays.length ? rule.weekdays : [weekdayOfKey(rule.startDate)];
      const anchor = weekStartKey(rule.startDate);
      for (let i = 1; i <= 7 * interval + 7; i++) {
        const key = addDaysToKey(from, i);
        if (!within(key)) return null;
        const weekIndex = Math.floor(diffDateKeys(anchor, key) / 7);
        if (weekIndex % interval === 0 && days.includes(weekdayOfKey(key))) return key;
      }
      return null;
    }
    case 'MONTHLY': {
      const start = jalaliOfKey(rule.startDate, cal.timeZone);
      const day = rule.dayOfMonth ?? Math.min(start.day, 29);
      for (let i = 1; i <= 31 * interval + 62; i++) {
        const key = addDaysToKey(from, i);
        if (!within(key)) return null;
        const j = jalaliOfKey(key, cal.timeZone);
        const months = (j.year - start.year) * 12 + (j.month - start.month);
        if (j.day === day && months % interval === 0) return key;
      }
      return null;
    }
  }
}

/** Occurrences due on or before `todayKey`, starting at `pendingKey` (max `limit`). */
export function dueOccurrences(
  rule: RuleShape,
  pendingKey: string | null,
  todayKey: string,
  cal: Calendar,
  limit = 5,
): { due: string[]; next: string | null } {
  const due: string[] = [];
  let key = pendingKey;
  while (key && key <= todayKey && due.length < limit) {
    due.push(key);
    key = nextOccurrence(rule, key, cal);
  }
  return { due, next: key };
}
