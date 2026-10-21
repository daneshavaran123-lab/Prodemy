import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  delayDays,
  endOfZonedDay,
  normalizePersian,
  toLatinDigits,
  toPersianDigits,
  workingDaysUntil,
  zonedDateKey,
  zonedTimeToUtc,
} from './utils';

test('zonedDateKey uses Tehran calendar day', () => {
  // 2026-10-20T21:00Z is 00:30 on 21 Oct in Tehran (UTC+3:30).
  assert.equal(zonedDateKey(new Date('2026-10-20T21:00:00Z')), '2026-10-21');
  assert.equal(zonedDateKey(new Date('2026-10-20T20:00:00Z')), '2026-10-20');
});

test('zonedTimeToUtc / endOfZonedDay round-trip', () => {
  assert.equal(zonedTimeToUtc('2026-10-21', 0, 0).toISOString(), '2026-10-20T20:30:00.000Z');
  assert.equal(endOfZonedDay(new Date('2026-10-21T08:00:00Z')).toISOString(), '2026-10-21T20:29:59.999Z');
});

test('delayDays counts local calendar days', () => {
  const deadline = new Date('2026-10-20T10:00:00Z'); // 13:30 Tehran
  assert.equal(delayDays(deadline, new Date('2026-10-20T09:00:00Z')), 0);
  assert.equal(delayDays(deadline, new Date('2026-10-20T10:00:01Z')), 1);
  assert.equal(delayDays(deadline, new Date('2026-10-22T11:00:00Z')), 2);
  // 23:59 deadline, checked shortly after midnight → one day late.
  assert.equal(delayDays(new Date('2026-10-20T20:29:00Z'), new Date('2026-10-20T20:31:00Z')), 1);
});

test('workingDaysUntil skips Friday and holidays', () => {
  // Iranian work week: Sat(6)…Wed(3) + Thu(4); Friday (5) off.
  const workingDays = [6, 0, 1, 2, 3, 4];
  const now = new Date('2026-10-20T06:00:00Z'); // Tue
  const deadline = new Date('2026-10-24T12:00:00Z'); // Sat
  assert.equal(workingDaysUntil(now, deadline, workingDays, []), 3); // Wed, Thu, Sat
  assert.equal(workingDaysUntil(now, deadline, workingDays, ['2026-10-22']), 2);
  assert.equal(workingDaysUntil(deadline, now, workingDays, []), 0);
});

test('digit and letter normalization', () => {
  assert.equal(toPersianDigits(1405), '۱۴۰۵');
  assert.equal(toLatinDigits('۱۴۰۵/۰۷/۲۸'), '1405/07/28');
  assert.equal(normalizePersian('علي  كريمي'), 'علی کریمی');
});
