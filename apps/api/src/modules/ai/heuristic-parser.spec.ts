import { detectDeadline, heuristicParse } from './heuristic-parser';

const tz = 'Asia/Tehran';
// Tuesday 28 Mehr 1405.
const now = new Date('2026-10-20T08:00:00Z');
const candidates = [
  { id: 'ali', fullName: 'علی رضایی' },
  { id: 'sara', fullName: 'سارا محمدی' },
  { id: 'ali2', fullName: 'علی‌اکبر کریمی' },
];

describe('heuristicParse', () => {
  it('parses the PRD §49 example', () => {
    const d = heuristicParse(
      'گزارش فروش مهر را علی تا پنجشنبه آماده کند و اولویت بالا باشد.',
      candidates,
      'me',
      now,
      tz,
    );
    expect(d.title).toBe('گزارش فروش مهر');
    expect(d.assigneeId).toBe('ali');
    expect(d.deadlineKey).toBe('2026-10-22');
    expect(d.priority).toBe('HIGH');
  });

  it('flags ambiguous first names', () => {
    const d = heuristicParse(
      'سارا و علی جلسه را هماهنگ کنند',
      [...candidates, { id: 'x', fullName: 'سارا کاظمی' }],
      'me',
      now,
      tz,
    );
    expect(d.assigneeId).toBeNull();
    expect(d.warnings.length).toBeGreaterThan(0);
  });

  it('understands self assignment, urgency and tags', () => {
    const d = heuristicParse('برای خودم: تمدید قرارداد سرور فوری تا فردا #زیرساخت', candidates, 'me', now, tz);
    expect(d.assigneeId).toBe('me');
    expect(d.priority).toBe('URGENT');
    expect(d.deadlineKey).toBe('2026-10-21');
    expect(d.tags).toEqual(['زیرساخت']);
  });
});

describe('detectDeadline', () => {
  const today = '2026-10-20';
  it.each([
    ['تا شنبه', '2026-10-24'],
    ['تا سه‌شنبه', '2026-10-27'],
    ['شنبه هفته بعد', '2026-10-31'],
    ['۵ روز دیگر', '2026-10-25'],
    ['تا ۱۰ آبان', '2026-11-01'],
    ['مهلت ۱۴۰۵/۰۸/۱۵', '2026-11-06'],
    ['تا آخر ماه', '2026-10-22'],
  ])('%s → %s', (phrase, key) => {
    expect(detectDeadline(phrase, today, tz).key).toBe(key);
  });
});
