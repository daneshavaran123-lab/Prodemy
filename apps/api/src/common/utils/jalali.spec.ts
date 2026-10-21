import { currentJalaliPeriod, formatJalali, jalaliMonthKeys, jalaliToDateKey } from './jalali';

const tz = 'Asia/Tehran';

describe('jalali utils', () => {
  it('converts Jalali dates to Gregorian keys', () => {
    expect(jalaliToDateKey(1405, 7, 28, tz)).toBe('2026-10-20');
    expect(jalaliToDateKey(1405, 1, 1, tz)).toBe('2026-03-21');
    expect(jalaliToDateKey(1404, 12, 29, tz)).toBe('2026-03-20');
    expect(jalaliToDateKey(1403, 12, 30, tz)).toBe('2025-03-20'); // leap Esfand
  });

  it('computes month ranges and current period', () => {
    expect(jalaliMonthKeys('1405-07', tz)).toEqual({ start: '2026-09-23', end: '2026-10-23' });
    expect(jalaliMonthKeys('1405-12', tz).end).toBe(jalaliToDateKey(1406, 1, 1, tz));
    expect(currentJalaliPeriod(new Date('2026-10-20T08:00:00Z'), tz)).toBe('1405-07');
    expect(currentJalaliPeriod(new Date('2026-10-20T08:00:00Z'), tz, -7)).toBe('1404-12');
  });

  it('formats in Persian', () => {
    expect(formatJalali(new Date('2026-10-20T08:00:00Z'), tz)).toBe('۲۸ مهر ۱۴۰۵');
    expect(formatJalali(new Date('2026-10-20T08:00:00Z'), tz, { weekday: true })).toBe('سه‌شنبه ۲۸ مهر ۱۴۰۵');
  });
});
