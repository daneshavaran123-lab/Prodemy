import { addDaysToKey, normalizePersian, weekdayOfKey, zonedDateKey, type TaskPriority } from '@karban/shared';
import { jalaliMonthKeys, jalaliParts, jalaliToDateKey, JALALI_MONTHS } from '../../common/utils/jalali';

export interface Candidate {
  id: string;
  fullName: string;
}

export interface HeuristicDraft {
  title: string;
  description: string;
  assigneeId: string | null;
  unresolvedAssignee: string | null;
  /** Local date key of the deadline (end of day is applied by the caller). */
  deadlineKey: string | null;
  priority: TaskPriority;
  tags: string[];
  warnings: string[];
  confidence: number;
}

const WEEKDAY_PREFIX: Record<string, number> = { یک: 0, دو: 1, سه: 2, چهار: 3, پنج: 4 };
const WEEKDAY_WORDS: Record<string, number> = {
  یکشنبه: 0,
  دوشنبه: 1,
  سهشنبه: 2,
  چهارشنبه: 3,
  پنجشنبه: 4,
  جمعه: 5,
  شنبه: 6,
};

/** Finds a weekday name, handling both "سه‌شنبه" (split by ZWNJ/space) and "پنجشنبه". */
function findWeekday(normalized: string): { weekday: number; matched: string } | null {
  const words = normalized.split(/[\s،,.!?؟:]+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === 'شنبه' && i > 0 && words[i - 1] in WEEKDAY_PREFIX) {
      return { weekday: WEEKDAY_PREFIX[words[i - 1]], matched: `${words[i - 1]} ${w}` };
    }
    if (w in WEEKDAY_WORDS) return { weekday: WEEKDAY_WORDS[w], matched: w };
  }
  return null;
}

function detectPriority(text: string): { priority: TaskPriority; matched: string | null } {
  const rules: Array<[RegExp, TaskPriority]> = [
    [/(اولویت|الویت)\s*(فوری|اضطراری)|فوری|اضطراری|خیلی ضروری/, 'URGENT'],
    [/(اولویت|الویت)\s*(بالا|زیاد)|خیلی مهم|مهم/, 'HIGH'],
    [/(اولویت|الویت)\s*(کم|پایین)|عجله ای نیست|عجله‌ای نیست/, 'LOW'],
    [/(اولویت|الویت)\s*(عادی|معمولی|متوسط)/, 'NORMAL'],
  ];
  for (const [re, p] of rules) {
    const m = re.exec(text);
    if (m) return { priority: p, matched: m[0] };
  }
  return { priority: 'NORMAL', matched: null };
}

/** Resolves Persian relative/explicit deadline phrases to a local date key. */
export function detectDeadline(
  text: string,
  todayKey: string,
  timeZone: string,
): { key: string | null; matched: string | null } {
  const t = normalizePersian(text);

  const explicit = /(1[34]\d{2})[/\-.](\d{1,2})[/\-.](\d{1,2})/.exec(t);
  if (explicit) {
    const key = jalaliToDateKey(Number(explicit[1]), Number(explicit[2]), Number(explicit[3]), timeZone);
    return { key, matched: explicit[0] };
  }

  const today = jalaliParts(new Date(`${todayKey}T12:00:00Z`), timeZone);
  const dayMonth = new RegExp(`(\\d{1,2})\\s*(${JALALI_MONTHS.join('|')})(?:\\s*(?:ماه)?\\s*(1[34]\\d{2}))?`).exec(t);
  if (dayMonth) {
    const month = JALALI_MONTHS.indexOf(dayMonth[2]) + 1;
    let year = dayMonth[3] ? Number(dayMonth[3]) : today.year;
    if (!dayMonth[3] && (month < today.month || (month === today.month && Number(dayMonth[1]) < today.day))) year++;
    return { key: jalaliToDateKey(year, month, Number(dayMonth[1]), timeZone), matched: dayMonth[0] };
  }

  if (/پس ?فردا|پس‌فردا/.test(t)) return { key: addDaysToKey(todayKey, 2), matched: 'پس‌فردا' };
  if (/فردا/.test(t)) return { key: addDaysToKey(todayKey, 1), matched: 'فردا' };
  if (/امروز|همین امروز|تا آخر وقت/.test(t)) return { key: todayKey, matched: 'امروز' };

  const inDays = /(\d+)\s*روز\s*(دیگر|آینده|بعد)/.exec(t);
  if (inDays) return { key: addDaysToKey(todayKey, Number(inDays[1])), matched: inDays[0] };
  const inWeeks = /(\d+)\s*هفته\s*(دیگر|آینده|بعد)/.exec(t);
  if (inWeeks) return { key: addDaysToKey(todayKey, 7 * Number(inWeeks[1])), matched: inWeeks[0] };

  if (/آخر ماه|پایان ماه/.test(t)) {
    const { end } = jalaliMonthKeys(`${today.year}-${String(today.month).padStart(2, '0')}`, timeZone);
    return { key: addDaysToKey(end, -1), matched: 'آخر ماه' };
  }

  const nextWeek = /هفته(ٔ|ی| ی)?\s*(بعد|آینده)/.test(t);
  const weekday = findWeekday(t);
  if (weekday) {
    let delta = (weekday.weekday - weekdayOfKey(todayKey) + 7) % 7;
    if (delta === 0) delta = 7;
    if (nextWeek && delta < 7) delta += 7;
    return { key: addDaysToKey(todayKey, delta), matched: weekday.matched };
  }
  if (nextWeek) return { key: addDaysToKey(todayKey, 7), matched: 'هفته بعد' };
  return { key: null, matched: null };
}

/** Name matching keeps ZWNJ compounds ("علی‌اکبر") as one token. */
const nameNorm = (s: string) => normalizePersian(s.replace(/\u200c/g, ''));

function detectAssignee(text: string, candidates: Candidate[], selfId: string) {
  if (/(خودم|برای من|به من)/.test(text))
    return { id: selfId, unresolved: null, matched: null as string | null, ambiguous: false };
  const norm = nameNorm(text);
  const full = candidates.filter((c) => norm.includes(nameNorm(c.fullName)));
  if (full.length === 1) return { id: full[0].id, unresolved: null, matched: full[0].fullName, ambiguous: false };
  const tokens = new Map<string, Candidate[]>();
  for (const c of candidates) {
    for (const part of nameNorm(c.fullName).split(' ')) {
      if (part.length < 2) continue;
      tokens.set(part, [...(tokens.get(part) ?? []), c]);
    }
  }
  const words = norm.split(/[\s،,.!?؟]+/);
  for (const w of words) {
    const hits = tokens.get(w);
    if (hits?.length === 1) return { id: hits[0].id, unresolved: null, matched: w, ambiguous: false };
    if (hits && hits.length > 1) return { id: null, unresolved: w, matched: w, ambiguous: true };
  }
  return { id: null, unresolved: null, matched: null, ambiguous: false };
}

/**
 * Rule-based Persian parser used when the AI provider is disabled or unavailable,
 * so natural-language task creation keeps working offline (PRD §49, §59).
 */
export function heuristicParse(
  text: string,
  candidates: Candidate[],
  selfId: string,
  now: Date,
  timeZone: string,
): HeuristicDraft {
  const clean = normalizePersian(text);
  const warnings: string[] = [];
  const todayKey = zonedDateKey(now, timeZone);
  const { priority, matched: pMatch } = detectPriority(clean);
  const { key: deadlineKey, matched: dMatch } = detectDeadline(clean, todayKey, timeZone);
  const assignee = detectAssignee(text, candidates, selfId);
  const tags = [...clean.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1]);

  // Title: the object of the sentence ("X را …") or the leading words without metadata phrases.
  let title = clean;
  const objectMarker = clean.indexOf(' را ');
  if (objectMarker > 0) title = clean.slice(0, objectMarker);
  for (const fragment of [pMatch, dMatch, assignee.matched]) {
    if (fragment) title = title.replace(fragment, ' ');
  }
  title = title
    .replace(/#[\p{L}\p{N}_-]+/gu, ' ')
    .replace(/\b(تا|برای|و|که)\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 12)
    .join(' ');
  if (!title) title = clean.split(' ').slice(0, 8).join(' ');

  if (!deadlineKey) warnings.push('مهلت انجام از متن تشخیص داده نشد؛ لطفاً آن را تعیین کنید.');
  if (assignee.ambiguous) warnings.push(`نام «${assignee.unresolved}» با چند نفر مطابقت دارد؛ مسئول را انتخاب کنید.`);
  else if (!assignee.id) warnings.push('مسئول وظیفه از متن تشخیص داده نشد.');

  const confidence =
    Math.round((((deadlineKey ? 1 : 0) + (assignee.id ? 1 : 0) + (pMatch ? 1 : 0.5) + 1) / 4) * 100) / 100;
  return {
    title,
    description: text.trim(),
    assigneeId: assignee.id,
    unresolvedAssignee: assignee.id ? null : assignee.unresolved,
    deadlineKey,
    priority,
    tags,
    warnings,
    confidence,
  };
}
