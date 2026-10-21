'use client';

import * as React from 'react';
import type { TrendPoint } from '@karban/shared';
import { cn, faNum, formatShortDate } from '@/lib/utils';

/*
 * Small hand-built SVG charts following the data-viz method:
 * thin marks (≤24px bars, 4px rounded data-ends, 2px lines), hairline solid grid,
 * validated categorical slots (--series-1..4), a legend for ≥2 series, tooltips on hover,
 * text in ink tokens (never the series color). Time runs left → right.
 */

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const steps = [1, 2, 2.5, 5, 10];
  for (const s of steps) if (v <= s * pow) return s * pow;
  return 10 * pow;
}

function Tooltip({ x, y, children, width }: { x: number; y: number; children: React.ReactNode; width: number }) {
  const left = Math.min(Math.max(x, 70), width - 70);
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
      style={{ left, top: y - 8 }}
      dir="rtl"
    >
      {children}
    </div>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string; line?: boolean }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span
            className={cn(i.line ? 'h-0.5 w-3.5 rounded-full' : 'size-2.5 rounded-[3px]')}
            style={{ background: i.color }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Width of the chart box. Charts size their SVG with CSS (`w-full`) so the box follows the layout, not the drawing. */
function useWidth<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const [width, setWidth] = React.useState(600);
  React.useLayoutEffect(() => {
    if (!ref.current) return;
    setWidth(Math.max(260, ref.current.clientWidth));
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Weekly completions, stacked on-time (slot 1) / late (slot 2). */
export function CompletionTrendChart({ data, height = 200 }: { data: TrendPoint[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<number | null>(null);
  const pad = { top: 12, right: 8, bottom: 26, left: 30 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(1, ...data.map((d) => d.completed)));
  const band = innerW / Math.max(1, data.length);
  const barW = Math.min(24, band * 0.6);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(innerW / 56)));

  return (
    <div className="grid gap-2">
      <Legend
        items={[
          { label: 'تکمیل به‌موقع', color: 'var(--color-series-1)' },
          { label: 'تکمیل با تأخیر', color: 'var(--color-series-2)' },
        ]}
      />
      <div ref={ref} className="relative" dir="ltr" onMouseLeave={() => setHover(null)}>
        <svg className="block w-full" height={height} role="img" aria-label="روند هفتگی تکمیل وظایف">
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--color-chart-grid)"
                strokeWidth={1}
              />
              <text
                x={pad.left - 6}
                y={y(t)}
                dy="0.32em"
                textAnchor="end"
                fontSize={10}
                fill="var(--color-chart-muted)"
                className="tabular"
              >
                {faNum(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = pad.left + band * i + band / 2;
            const onTime = d.completedOnTime;
            const late = d.completed - d.completedOnTime;
            const yOn = y(onTime);
            const yLate = y(onTime + late);
            const r = 4;
            return (
              <g key={d.periodStart} opacity={hover === null || hover === i ? 1 : 0.55}>
                {onTime > 0 && (
                  <path
                    d={
                      late > 0
                        ? `M${cx - barW / 2},${y(0)} V${yOn} H${cx + barW / 2} V${y(0)} Z`
                        : roundedTop(cx - barW / 2, yOn, barW, y(0) - yOn, r)
                    }
                    fill="var(--color-series-1)"
                  />
                )}
                {late > 0 && (
                  <path
                    d={roundedTop(cx - barW / 2, yLate, barW, yOn - yLate - (onTime > 0 ? 2 : 0), r)}
                    fill="var(--color-series-2)"
                  />
                )}
                {i % labelEvery === 0 && (
                  <text x={cx} y={height - 8} textAnchor="middle" fontSize={10} fill="var(--color-chart-muted)">
                    {formatShortDate(d.periodStart)}
                  </text>
                )}
                <rect
                  x={cx - band / 2}
                  y={pad.top}
                  width={band}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                />
              </g>
            );
          })}
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={y(0)}
            y2={y(0)}
            stroke="var(--color-chart-axis)"
            strokeWidth={1}
          />
        </svg>
        {hover !== null && data[hover] && (
          <Tooltip x={pad.left + band * hover + band / 2} y={y(data[hover].completed)} width={width}>
            <p className="mb-1 font-medium">هفته {formatShortDate(data[hover].periodStart)}</p>
            <p>تکمیل به‌موقع: {faNum(data[hover].completedOnTime)}</p>
            <p>تکمیل با تأخیر: {faNum(data[hover].completed - data[hover].completedOnTime)}</p>
            <p className="text-muted-foreground">ایجاد شده: {faNum(data[hover].created)}</p>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

/** Single-series line: open overdue tasks at the end of each week. */
export function OverdueTrendChart({ data, height = 160 }: { data: TrendPoint[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<number | null>(null);
  const pad = { top: 14, right: 12, bottom: 26, left: 30 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(1, ...data.map((d) => d.overdueOpen)));
  const step = innerW / Math.max(1, data.length - 1);
  const x = (i: number) => pad.left + step * i;
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.overdueOpen)}`).join(' ');
  const area = `${path} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const last = data.length - 1;
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(innerW / 56)));

  return (
    <div
      ref={ref}
      className="relative"
      dir="ltr"
      onMouseLeave={() => setHover(null)}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const i = Math.round((e.clientX - rect.left - pad.left) / step);
        setHover(Math.max(0, Math.min(last, i)));
      }}
    >
      <svg className="block w-full" height={height} role="img" aria-label="روند وظایف عقب‌افتاده باز">
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--color-chart-grid)" />
            <text x={pad.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10} fill="var(--color-chart-muted)">
              {faNum(t)}
            </text>
          </g>
        ))}
        {data.length > 1 && <path d={area} fill="var(--color-series-2)" opacity={0.1} />}
        <path
          d={path}
          fill="none"
          stroke="var(--color-series-2)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {data.map((d, i) =>
          i % labelEvery === 0 ? (
            <text
              key={d.periodStart}
              x={x(i)}
              y={height - 8}
              textAnchor="middle"
              fontSize={10}
              fill="var(--color-chart-muted)"
            >
              {formatShortDate(d.periodStart)}
            </text>
          ) : null,
        )}
        {last >= 0 && (
          <>
            <circle
              cx={x(last)}
              cy={y(data[last].overdueOpen)}
              r={4}
              fill="var(--color-series-2)"
              stroke="var(--color-card)"
              strokeWidth={2}
            />
            <text
              x={x(last) - 8}
              y={y(data[last].overdueOpen) - 8}
              textAnchor="end"
              fontSize={11}
              fill="var(--color-foreground)"
              fontWeight={600}
            >
              {faNum(data[last].overdueOpen)}
            </text>
          </>
        )}
        {hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={y(0)} stroke="var(--color-chart-axis)" />
            <circle
              cx={x(hover)}
              cy={y(data[hover].overdueOpen)}
              r={4}
              fill="var(--color-series-2)"
              stroke="var(--color-card)"
              strokeWidth={2}
            />
          </>
        )}
      </svg>
      {hover !== null && data[hover] && (
        <Tooltip x={x(hover)} y={y(data[hover].overdueOpen)} width={width}>
          <p className="font-medium">پایان هفته {formatShortDate(data[hover].periodStart)}</p>
          <p>{faNum(data[hover].overdueOpen)} وظیفه عقب‌افتاده باز</p>
        </Tooltip>
      )}
    </div>
  );
}

/** Horizontal bars, one series (slot 1); value at the tip. RTL: bars grow from the right. */
export function HBarList({
  rows,
  format = (v) => faNum(v),
  max: maxProp,
  onSelect,
}: {
  rows: Array<{
    key: string;
    label: React.ReactNode;
    value: number;
    hint?: React.ReactNode;
    tone?: 'default' | 'alert';
  }>;
  format?: (v: number) => string;
  max?: number;
  onSelect?: (key: string) => void;
}) {
  const max = maxProp ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="grid gap-2.5">
      {rows.map((r) => (
        <li key={r.key}>
          <button
            type="button"
            disabled={!onSelect}
            onClick={() => onSelect?.(r.key)}
            className={cn(
              'group grid w-full grid-cols-[minmax(6rem,11rem)_1fr_auto] items-center gap-3 text-start text-sm',
              onSelect && 'cursor-pointer',
            )}
            title={typeof r.label === 'string' ? `${r.label}: ${format(r.value)}` : undefined}
          >
            <span className="truncate">{r.label}</span>
            <span className="relative h-3 rounded-full bg-muted/60">
              <span
                className="absolute inset-y-0 start-0 rounded-full transition-[width] group-hover:opacity-80"
                style={{
                  width: `${(r.value / max) * 100}%`,
                  background: r.tone === 'alert' ? 'var(--color-series-2)' : 'var(--color-series-1)',
                }}
              />
            </span>
            <span className="min-w-10 text-xs tabular text-muted-foreground">
              {format(r.value)}
              {r.hint && <span className="ms-1">{r.hint}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Part-to-whole stacked bar with a 2px surface gap between segments. */
export function StackedBar({ segments }: { segments: Array<{ label: string; value: number; color: string }> }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const [hover, setHover] = React.useState<number | null>(null);
  return (
    <div className="grid gap-3">
      <div
        className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-muted"
        onMouseLeave={() => setHover(null)}
      >
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((s, i) => (
              <span
                key={s.label}
                className="h-full transition-opacity first:rounded-s-full last:rounded-e-full"
                style={{
                  width: `${(s.value / total) * 100}%`,
                  background: s.color,
                  opacity: hover === null || hover === i ? 1 : 0.5,
                }}
                onMouseEnter={() => setHover(i)}
                title={`${s.label}: ${faNum(s.value)}`}
              />
            ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
            {s.label} <span className="font-medium tabular text-foreground">{faNum(s.value)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Inline meter for table cells (ratio 0..1). Track is a lighter step of the same ramp. */
export function Meter({ value, label, invert }: { value: number | null; label?: string; invert?: boolean }) {
  if (value === null) return <span className="text-xs text-muted-foreground">—</span>;
  const pct = Math.round(value * 100);
  const bad = invert ? value >= 0.25 : value < 0.6;
  return (
    <span className="inline-flex min-w-28 items-center gap-2" title={label}>
      <span className="relative h-1.5 w-16 rounded-full bg-series-track/50">
        <span
          className="absolute inset-y-0 start-0 rounded-full"
          style={{
            width: `${Math.min(100, pct)}%`,
            background: bad ? 'var(--color-series-2)' : 'var(--color-series-1)',
          }}
        />
      </span>
      <span className="text-xs tabular">{faNum(pct)}٪</span>
    </span>
  );
}
