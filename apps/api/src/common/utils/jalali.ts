/** Server-side Persian (Jalali) formatting via ICU — used in notification and email text. */
const cache = new Map<string, Intl.DateTimeFormat>();

function cached(key: string, make: () => Intl.DateTimeFormat): Intl.DateTimeFormat {
  let f = cache.get(key);
  if (!f) {
    f = make();
    cache.set(key, f);
  }
  return f;
}

/** e.g. "۲۸ مهر ۱۴۰۵", "سه‌شنبه ۲۸ مهر ۱۴۰۵", "۲۸ مهر ۱۴۰۵ ساعت ۱۷:۰۰". */
export function formatJalali(
  date: Date,
  timeZone: string,
  opts: { withTime?: boolean; weekday?: boolean } = {},
): string {
  const main = cached(
    `d|${timeZone}|${!!opts.withTime}`,
    () =>
      new Intl.DateTimeFormat('fa-IR', {
        timeZone,
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        ...(opts.withTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const } : {}),
      }),
  ).format(date);
  if (!opts.weekday) return main;
  const weekday = cached(`w|${timeZone}`, () => new Intl.DateTimeFormat('fa-IR', { timeZone, weekday: 'long' })).format(
    date,
  );
  return `${weekday} ${main}`;
}

/** Numeric Jalali parts of an instant in the given time zone. */
export function jalaliParts(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = cached(
    `p|${timeZone}`,
    () =>
      new Intl.DateTimeFormat('en-US-u-ca-persian', {
        timeZone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
      }),
  ).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

export function faNumber(value: number): string {
  return new Intl.NumberFormat('fa-IR').format(value);
}

const MONTH_START = [0, 31, 62, 93, 124, 155, 186, 216, 246, 276, 306, 336];

/** Gregorian date key (YYYY-MM-DD) of a Jalali date, resolved through ICU. */
export function jalaliToDateKey(jy: number, jm: number, jd: number, timeZone: string): string {
  // Start from an estimate (1 Farvardin ≈ 21 March) and correct using the day offset.
  let t = Date.UTC(jy + 621, 2, 21, 12) + (MONTH_START[jm - 1] + jd - 1) * 86_400_000;
  for (let i = 0; i < 10; i++) {
    const p = jalaliParts(new Date(t), timeZone);
    if (p.year === jy && p.month === jm && p.day === jd) break;
    let delta = (jy - p.year) * 365 + (MONTH_START[jm - 1] - MONTH_START[p.month - 1]) + (jd - p.day);
    // The 365-day estimate can be off by one across leap years; step towards the target.
    if (delta === 0) delta = jy * 10000 + jm * 100 + jd > p.year * 10000 + p.month * 100 + p.day ? 1 : -1;
    t += delta * 86_400_000;
  }
  return new Date(t).toISOString().slice(0, 10);
}

/** Jalali month (`1405-07`) → [first day key, first day of next month key). */
export function jalaliMonthKeys(period: string, timeZone: string): { start: string; end: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) throw new Error(`Invalid Jalali period: ${period}`);
  const jy = Number(m[1]);
  const jm = Number(m[2]);
  if (jm < 1 || jm > 12) throw new Error(`Invalid Jalali month: ${period}`);
  const next = jm === 12 ? { y: jy + 1, m: 1 } : { y: jy, m: jm + 1 };
  return { start: jalaliToDateKey(jy, jm, 1, timeZone), end: jalaliToDateKey(next.y, next.m, 1, timeZone) };
}

export function currentJalaliPeriod(now: Date, timeZone: string, offsetMonths = 0): string {
  const p = jalaliParts(now, timeZone);
  let y = p.year;
  let m = p.month + offsetMonths;
  while (m < 1) {
    m += 12;
    y--;
  }
  while (m > 12) {
    m -= 12;
    y++;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export const JALALI_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];
