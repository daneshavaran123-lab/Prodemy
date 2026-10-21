import { OPEN_TASK_STATUSES, type TaskStatus } from './enums';

export const DEFAULT_TIMEZONE = 'Asia/Tehran';
export const DAY_MS = 24 * 60 * 60 * 1000;

export function isOpenStatus(status: TaskStatus): boolean {
  return OPEN_TASK_STATUSES.includes(status);
}

/** True when an open task's deadline has passed. */
export function isTaskOverdue(status: TaskStatus, deadline: Date, now: Date): boolean {
  return isOpenStatus(status) && deadline.getTime() < now.getTime();
}

/**
 * Days of delay counted in local calendar days: late on the deadline day itself counts
 * as one day, otherwise the number of calendar days between deadline and `reference`.
 * For completed tasks pass the completion time as `reference`.
 */
export function delayDays(deadline: Date, reference: Date, timeZone: string = DEFAULT_TIMEZONE): number {
  if (reference.getTime() <= deadline.getTime()) return 0;
  return Math.max(1, diffDateKeys(zonedDateKey(deadline, timeZone), zonedDateKey(reference, timeZone)));
}

const keyFormatters = new Map<string, Intl.DateTimeFormat>();
function keyFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = keyFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    keyFormatters.set(timeZone, f);
  }
  return f;
}

/** Calendar date (YYYY-MM-DD, Gregorian) of an instant in the given time zone. */
export function zonedDateKey(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return keyFormatter(timeZone).format(date);
}

/** Offset (minutes, east of UTC positive) of `timeZone` at the given instant. */
export function timeZoneOffsetMinutes(date: Date, timeZone: string = DEFAULT_TIMEZONE): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** UTC instant of local wall-clock time `dateKey hh:mm` in `timeZone`. */
export function zonedTimeToUtc(dateKey: string, hours = 0, minutes = 0, timeZone: string = DEFAULT_TIMEZONE): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, hours, minutes, 0, 0);
  // Two passes handle offset changes around the target instant.
  let offset = timeZoneOffsetMinutes(new Date(naive), timeZone);
  let result = naive - offset * 60000;
  const offset2 = timeZoneOffsetMinutes(new Date(result), timeZone);
  if (offset2 !== offset) {
    offset = offset2;
    result = naive - offset * 60000;
  }
  return new Date(result);
}

export function startOfZonedDay(date: Date, timeZone: string = DEFAULT_TIMEZONE): Date {
  return zonedTimeToUtc(zonedDateKey(date, timeZone), 0, 0, timeZone);
}

/** Last millisecond of the local calendar day containing `date`. */
export function endOfZonedDay(date: Date, timeZone: string = DEFAULT_TIMEZONE): Date {
  const next = addDaysToKey(zonedDateKey(date, timeZone), 1);
  return new Date(zonedTimeToUtc(next, 0, 0, timeZone).getTime() - 1);
}

export function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Signed number of calendar days from key `a` to key `b`. */
export function diffDateKeys(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}

/** Day of week (0 = Sunday … 6 = Saturday) of a YYYY-MM-DD key. */
export function weekdayOfKey(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Working days remaining from `now` until `deadline` (inclusive of the deadline day,
 * exclusive of today), skipping non-working weekdays and holidays.
 * Returns 0 when the deadline is today, negative-free (overdue → 0).
 */
export function workingDaysUntil(
  now: Date,
  deadline: Date,
  workingDays: readonly number[],
  holidays: readonly string[],
  timeZone: string = DEFAULT_TIMEZONE,
): number {
  const today = zonedDateKey(now, timeZone);
  const end = zonedDateKey(deadline, timeZone);
  const span = diffDateKeys(today, end);
  if (span <= 0) return 0;
  const holidaySet = new Set(holidays);
  let count = 0;
  for (let i = 1; i <= span && i <= 3660; i++) {
    const key = addDaysToKey(today, i);
    if (workingDays.includes(weekdayOfKey(key)) && !holidaySet.has(key)) count++;
  }
  return count;
}

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

export function toPersianDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

/** Converts Persian/Arabic-Indic digits to ASCII (for parsing user input). */
export function toLatinDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
}

/** Normalizes Arabic letter variants to Persian forms (ي→ی, ك→ک) for search/matching. */
export function normalizePersian(value: string): string {
  return toLatinDigits(value)
    .replace(/ي/g, 'ی')
    .replace(/ى/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/‌/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function round(value: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
