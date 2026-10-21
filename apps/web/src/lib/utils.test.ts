import { describe, expect, it } from 'vitest';
import { ApiError, errorMessage, queryString } from './api';
import { formatBytes, relativeDeadline, timeAgo } from './utils';

// 11:30 in Tehran (UTC+03:30).
const now = new Date('2026-10-20T08:00:00Z');

describe('relativeDeadline', () => {
  it('phrases deadlines by Tehran calendar day', () => {
    expect(relativeDeadline('2026-10-20T15:00:00Z', now)).toEqual({ text: 'امروز تا ۱۸:۳۰', tone: 'warning' });
    expect(relativeDeadline('2026-10-21T10:00:00Z', now)).toEqual({ text: 'فردا', tone: 'warning' });
    expect(relativeDeadline('2026-10-23T10:00:00Z', now)).toEqual({ text: '۳ روز دیگر', tone: 'warning' });
    expect(relativeDeadline('2026-10-27T10:00:00Z', now)).toEqual({ text: '۷ روز دیگر', tone: 'muted' });
  });

  it('reports lateness for passed deadlines', () => {
    expect(relativeDeadline('2026-10-20T06:00:00Z', now)).toEqual({ text: 'مهلت امروز گذشت', tone: 'danger' });
    expect(relativeDeadline('2026-10-18T10:00:00Z', now)).toEqual({ text: '۲ روز تأخیر', tone: 'danger' });
  });

  it('uses the Tehran date, not the UTC date, around midnight', () => {
    // 23:30 Oct 20 in Tehran; the deadline is 00:30 Oct 21 there although both are Oct 20 in UTC.
    expect(relativeDeadline('2026-10-20T21:00:00Z', new Date('2026-10-20T20:00:00Z')).text).toBe('فردا');
  });
});

describe('timeAgo', () => {
  it('scales the unit with the distance', () => {
    expect(timeAgo('2026-10-20T07:59:30Z', now)).toBe('لحظاتی پیش');
    expect(timeAgo('2026-10-20T07:55:00Z', now)).toBe('۵ دقیقه پیش');
    expect(timeAgo('2026-10-20T05:00:00Z', now)).toBe('۳ ساعت پیش');
    expect(timeAgo('2026-10-18T08:00:00Z', now)).toBe('۲ روز پیش');
  });
});

describe('formatBytes', () => {
  it('picks a unit', () => {
    expect(formatBytes(512)).toBe('۵۱۲ بایت');
    expect(formatBytes(1536)).toBe('۱٫۵ کیلوبایت');
    expect(formatBytes(5 * 1024 * 1024)).toBe('۵ مگابایت');
  });
});

describe('queryString', () => {
  it('drops empty values and joins arrays', () => {
    expect(
      queryString({ q: 'گزارش', status: ['TODO', 'BLOCKED'], page: 2, mine: false, empty: '', none: null, list: [] }),
    ).toBe(`?q=${encodeURIComponent('گزارش')}&status=TODO%2CBLOCKED&page=2&mine=false`);
    expect(queryString({ q: '' })).toBe('');
    expect(queryString()).toBe('');
  });
});

describe('errorMessage', () => {
  it('surfaces API messages and the first validation details', () => {
    expect(errorMessage(new ApiError(403, 'دسترسی ندارید.', 'FORBIDDEN'))).toBe('دسترسی ندارید.');
    expect(
      errorMessage(new ApiError(400, 'ورودی نامعتبر است.', 'VALIDATION', ['عنوان الزامی است', 'مهلت الزامی است', 'x'])),
    ).toBe('ورودی نامعتبر است. (عنوان الزامی است، مهلت الزامی است)');
    expect(errorMessage(new Error('boom'))).toBe('خطای غیرمنتظره رخ داد.');
  });
});
