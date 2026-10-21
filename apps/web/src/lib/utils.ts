import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { DAY_MS, toPersianDigits } from '@karban/shared';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const TZ = 'Asia/Tehran';

const numberFmt = new Intl.NumberFormat('fa-IR');
const decimalFmt = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 });

export function faNum(value: number | null | undefined, decimals = false): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return (decimals ? decimalFmt : numberFmt).format(value);
}

/** 0..1 → "۸۸٪" */
export function faPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${numberFmt.format(Math.round(value * 100))}٪`;
}

const dateFmt = new Intl.DateTimeFormat('fa-IR', { timeZone: TZ, year: 'numeric', month: 'long', day: 'numeric' });
const shortDateFmt = new Intl.DateTimeFormat('fa-IR', { timeZone: TZ, month: 'long', day: 'numeric' });
const numericDateFmt = new Intl.DateTimeFormat('fa-IR', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat('fa-IR', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const weekdayFmt = new Intl.DateTimeFormat('fa-IR', { timeZone: TZ, weekday: 'long' });

const toDate = (d: string | Date) => (typeof d === 'string' ? new Date(d) : d);

/** "۲۸ مهر ۱۴۰۵" */
export function formatDate(d: string | Date | null | undefined): string {
  return d ? dateFmt.format(toDate(d)) : '—';
}

/** "۲۸ مهر" */
export function formatShortDate(d: string | Date | null | undefined): string {
  return d ? shortDateFmt.format(toDate(d)) : '—';
}

/** "۱۴۰۵/۰۷/۲۸" */
export function formatNumericDate(d: string | Date | null | undefined): string {
  return d ? numericDateFmt.format(toDate(d)) : '—';
}

export function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = toDate(d);
  return `${dateFmt.format(date)}، ساعت ${timeFmt.format(date)}`;
}

export function formatTime(d: string | Date): string {
  return timeFmt.format(toDate(d));
}

export function formatWeekday(d: string | Date): string {
  return weekdayFmt.format(toDate(d));
}

/** Deadline phrasing relative to now, e.g. "۳ روز دیگر", "امروز", "۲ روز تأخیر". */
export function relativeDeadline(
  deadline: string | Date,
  now = new Date(),
): { text: string; tone: 'danger' | 'warning' | 'muted' } {
  const d = toDate(deadline);
  const key = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(x);
  const days = Math.round((Date.parse(key(d)) - Date.parse(key(now))) / DAY_MS);
  if (d < now) {
    const late = Math.max(1, -days);
    return { text: days === 0 ? 'مهلت امروز گذشت' : `${toPersianDigits(late)} روز تأخیر`, tone: 'danger' };
  }
  if (days === 0) return { text: `امروز تا ${formatTime(d)}`, tone: 'warning' };
  if (days === 1) return { text: 'فردا', tone: 'warning' };
  if (days <= 3) return { text: `${toPersianDigits(days)} روز دیگر`, tone: 'warning' };
  return { text: `${toPersianDigits(days)} روز دیگر`, tone: 'muted' };
}

/** "۵ دقیقه پیش" style relative time for activity feeds. */
export function timeAgo(d: string | Date, now = new Date()): string {
  const diff = (now.getTime() - toDate(d).getTime()) / 1000;
  if (diff < 60) return 'لحظاتی پیش';
  if (diff < 3600) return `${toPersianDigits(Math.floor(diff / 60))} دقیقه پیش`;
  if (diff < 86400) return `${toPersianDigits(Math.floor(diff / 3600))} ساعت پیش`;
  if (diff < 7 * 86400) return `${toPersianDigits(Math.floor(diff / 86400))} روز پیش`;
  return formatDate(d);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${faNum(bytes)} بایت`;
  if (bytes < 1024 * 1024) return `${faNum(bytes / 1024, true)} کیلوبایت`;
  return `${faNum(bytes / 1024 / 1024, true)} مگابایت`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
}
