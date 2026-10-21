'use client';

import * as React from 'react';
import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  getDate,
  getDay,
  getDaysInMonth,
  getMonth,
  getYear,
  isSameDay,
  newDate,
  startOfMonth,
} from 'date-fns-jalali';
import { faIR } from 'date-fns-jalali/locale';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { toPersianDigits, zonedDateKey, zonedTimeToUtc } from '@karban/shared';
import { cn, formatDate, TZ } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger, Select } from './overlays';
import { Button } from './button';

const WEEKDAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

/** Half-hour slots for the working day plus "end of day"; keeps any existing custom time. */
function timeOptions(current: string) {
  const slots: string[] = [];
  for (let h = 7; h <= 22; h++) for (const m of ['00', '30']) slots.push(`${String(h).padStart(2, '0')}:${m}`);
  slots.push('23:59');
  if (!slots.includes(current)) slots.push(current);
  return slots.sort().map((t) => ({ value: t, label: t === '23:59' ? 'پایان روز' : toPersianDigits(t) }));
}

/** Local calendar date (browser) → Gregorian key; the picker works on whole days. */
const keyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dateOfKey = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};

export function JalaliCalendar({
  value,
  onSelect,
  minKey,
}: {
  value: string | null;
  onSelect: (key: string) => void;
  minKey?: string;
}) {
  const today = dateOfKey(zonedDateKey(new Date(), TZ));
  const selected = value ? dateOfKey(value) : null;
  const [view, setView] = React.useState(() => startOfMonth(selected ?? today));
  const days = getDaysInMonth(view);
  const offset = (getDay(view) + 1) % 7; // Saturday-first week
  const cells: Array<Date | null> = [
    ...Array(offset).fill(null),
    ...Array.from({ length: days }, (_, i) => newDate(getYear(view), getMonth(view), i + 1)),
  ];
  while (cells.length % 7) cells.push(null);

  return (
    <div className="w-64 select-none" dir="rtl">
      <div className="mb-2 flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setView(addMonths(view, -1))}
          aria-label="ماه قبل"
        >
          <ChevronRight />
        </Button>
        <span className="text-sm font-semibold">{toPersianDigits(format(view, 'MMMM yyyy', { locale: faIR }))}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setView(addMonths(view, 1))}
          aria-label="ماه بعد"
        >
          <ChevronLeft />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
        {WEEKDAYS.map((w, i) => (
          <span key={w} className={cn('py-1 font-medium text-muted-foreground', i === 6 && 'text-danger/80')}>
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={i} />;
          const key = keyOf(d);
          const disabled = !!minKey && key < minKey;
          const isSelected = !!selected && isSameDay(d, selected);
          const isToday = isSameDay(d, today);
          return (
            <button
              type="button"
              key={i}
              disabled={disabled}
              onClick={() => onSelect(key)}
              className={cn(
                'h-8 rounded-md text-sm tabular transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-30',
                isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                !isSelected && isToday && 'ring-1 ring-primary/50 font-semibold',
                i % 7 === 6 && !isSelected && 'text-danger/80',
              )}
            >
              {toPersianDigits(getDate(d))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const QUICK: Array<{ label: string; key: (today: Date) => Date }> = [
  { label: 'امروز', key: (t) => t },
  { label: 'فردا', key: (t) => addDays(t, 1) },
  { label: '۳ روز دیگر', key: (t) => addDays(t, 3) },
  { label: 'هفته بعد', key: (t) => addDays(t, 7) },
  { label: 'پایان ماه', key: (t) => endOfMonth(t) },
];

/**
 * Jalali date(-time) picker. `value` is an ISO instant; the chosen day/time is
 * interpreted in Asia/Tehran so deadlines mean the same for every viewer.
 */
export function DatePicker({
  value,
  onChange,
  withTime = false,
  defaultTime = '23:59',
  placeholder = 'انتخاب تاریخ',
  minToday = false,
  clearable = false,
  id,
  invalid,
}: {
  value: string | null;
  onChange: (iso: string | null) => void;
  withTime?: boolean;
  defaultTime?: string;
  placeholder?: string;
  minToday?: boolean;
  clearable?: boolean;
  id?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const date = value ? new Date(value) : null;
  const key = date ? zonedDateKey(date, TZ) : null;
  const time = date
    ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
        date,
      )
    : defaultTime;
  const todayKey = zonedDateKey(new Date(), TZ);

  const emit = (k: string, t: string) => {
    const [h, m] = t.split(':').map(Number);
    onChange(zonedTimeToUtc(k, h || 0, m || 0, TZ).toISOString());
  };

  return (
    <div className="flex gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            aria-invalid={invalid || undefined}
            className={cn(
              'flex h-9 w-full items-center gap-2 rounded-md border border-input bg-card px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 cursor-pointer aria-invalid:border-danger',
              !date && 'text-muted-foreground',
            )}
          >
            <CalendarDays className="size-4 opacity-60" />
            <span className="flex-1 truncate text-start">{date ? formatDate(date) : placeholder}</span>
            {clearable && date && (
              <span
                role="button"
                aria-label="پاک کردن"
                className="rounded p-0.5 hover:bg-muted"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                }}
              >
                <X className="size-3.5" />
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto">
          <div className="mb-3 flex flex-wrap gap-1">
            {QUICK.map((q) => (
              <button
                type="button"
                key={q.label}
                className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted cursor-pointer"
                onClick={() => {
                  emit(keyOf(q.key(dateOfKey(todayKey))), time);
                  setOpen(false);
                }}
              >
                {q.label}
              </button>
            ))}
          </div>
          <JalaliCalendar
            value={key}
            minKey={minToday ? todayKey : undefined}
            onSelect={(k) => {
              emit(k, time);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {withTime && (
        <Select
          value={time}
          onValueChange={(v) => key && emit(key, v)}
          disabled={!key}
          className="w-32 shrink-0"
          options={timeOptions(time)}
        />
      )}
    </div>
  );
}
