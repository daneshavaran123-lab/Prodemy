import { dueOccurrences, nextOccurrence, type Calendar, type RuleShape } from './recurrence.rules';

const cal: Calendar = { timeZone: 'Asia/Tehran', workingDays: [6, 0, 1, 2, 3, 4], holidays: [] };
const rule = (r: Partial<RuleShape>): RuleShape => ({
  frequency: 'WEEKLY',
  interval: 1,
  weekdays: [],
  dayOfMonth: null,
  startDate: '2026-10-17', // Saturday
  endDate: null,
  ...r,
});

describe('recurrence rules', () => {
  it('weekly "every Saturday" (PRD example: sales report every Saturday)', () => {
    const r = rule({ weekdays: [6] });
    expect(nextOccurrence(r, '2026-10-17', cal)).toBe('2026-10-24');
    expect(nextOccurrence(r, '2026-10-20', cal)).toBe('2026-10-24');
  });

  it('weekly with interval 2 and multiple weekdays', () => {
    const r = rule({ weekdays: [6, 1], interval: 2 });
    expect(nextOccurrence(r, '2026-10-17', cal)).toBe('2026-10-19'); // Monday same week
    expect(nextOccurrence(r, '2026-10-19', cal)).toBe('2026-10-31'); // skip a week
  });

  it('daily skips Friday and holidays', () => {
    const r = rule({ frequency: 'DAILY', startDate: '2026-10-21' });
    expect(nextOccurrence(r, '2026-10-22', cal)).toBe('2026-10-24'); // Thu → Sat (Fri off)
    expect(nextOccurrence(r, '2026-10-22', { ...cal, holidays: ['2026-10-24'] })).toBe('2026-10-25');
  });

  it('custom every 3 days', () => {
    const r = rule({ frequency: 'CUSTOM', interval: 3, startDate: '2026-10-01' });
    expect(nextOccurrence(r, '2026-10-01', cal)).toBe('2026-10-04');
    expect(nextOccurrence(r, '2026-10-05', cal)).toBe('2026-10-07');
  });

  it('monthly follows the Jalali month day', () => {
    // 2026-10-23 is 1 Aban 1405; next 1st of month is 1 Azar 1405 = 2026-11-22.
    const r = rule({ frequency: 'MONTHLY', startDate: '2026-10-23', dayOfMonth: 1 });
    expect(nextOccurrence(r, '2026-10-23', cal)).toBe('2026-11-22');
  });

  it('respects end date', () => {
    const r = rule({ weekdays: [6], endDate: '2026-10-30' });
    expect(nextOccurrence(r, '2026-10-24', cal)).toBeNull();
  });

  it('collects missed occurrences up to today (capped)', () => {
    const r = rule({ frequency: 'CUSTOM', interval: 1, startDate: '2026-10-01' });
    const { due, next } = dueOccurrences(r, '2026-10-01', '2026-10-03', cal);
    expect(due).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(next).toBe('2026-10-04');
  });
});
