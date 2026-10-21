'use client';

import Link from 'next/link';
import { Ban, Clock, FileWarning, ShieldAlert, UserX } from 'lucide-react';
import {
  ATTENTION_REASON_LABELS,
  DELAY_REASON_LABELS,
  type BlockerHotspot,
  type DelayReasonStat,
  TASK_EVENT_LABELS,
  TASK_STATUS_LABELS,
  WORKLOAD_STATE_LABELS,
  type ActivityItem,
  type AttentionReason,
  type KpiSet,
  type NeedsAttentionItem,
  type TaskPriority,
  type TaskStatus,
  type WorkloadRow,
} from '@karban/shared';
import { Avatar, Badge } from '@/components/ui/primitives';
import { StatTile } from '@/components/ui/layout';
import { HBarList, StackedBar } from '@/components/charts/charts';
import { DeadlineText, PriorityBadge } from '@/components/tasks/badges';
import { faNum, faPercent, timeAgo } from '@/lib/utils';

const REASON_STYLE: Partial<
  Record<AttentionReason, { variant: 'danger' | 'warning' | 'info' | 'neutral'; icon: React.ElementType }>
> = {
  CRITICAL_OVERDUE: { variant: 'danger', icon: Clock },
  OVERDUE: { variant: 'danger', icon: Clock },
  BLOCKED: { variant: 'danger', icon: Ban },
  HIGH_RISK: { variant: 'warning', icon: ShieldAlert },
  OWNER_INACTIVE: { variant: 'danger', icon: UserX },
  DELAY_REASON_MISSING: { variant: 'warning', icon: FileWarning },
};

export function KpiTiles({ kpis, compact }: { kpis: KpiSet; compact?: boolean }) {
  return (
    <div
      className={
        compact
          ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6'
          : 'grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6'
      }
    >
      <StatTile
        label="وظایف فعال"
        value={faNum(kpis.active)}
        hint={kpis.tasksPerEmployee !== null ? `${faNum(kpis.tasksPerEmployee, true)} وظیفه برای هر نفر` : undefined}
      />
      <StatTile
        label="عقب‌افتاده"
        value={faNum(kpis.overdue)}
        hint={`${faPercent(kpis.overdueRate)} از وظایف فعال`}
        tone={kpis.overdue ? 'danger' : 'default'}
        icon={<Clock />}
      />
      <StatTile
        label="در معرض تأخیر"
        value={faNum(kpis.atRisk)}
        hint="ریسک بالا، پیش از مهلت"
        tone={kpis.atRisk ? 'warning' : 'default'}
        icon={<ShieldAlert />}
      />
      <StatTile
        label="مسدود"
        value={faNum(kpis.blocked)}
        hint={`${faPercent(kpis.blockedRate)} از وظایف فعال`}
        tone={kpis.blocked ? 'danger' : 'default'}
        icon={<Ban />}
      />
      <StatTile
        label="تکمیل به‌موقع (۳۰ روز)"
        value={faPercent(kpis.onTimeRate)}
        hint={`${faNum(kpis.completedOnTime)} از ${faNum(kpis.completed)} وظیفه تکمیل‌شده`}
        tone="success"
      />
      <StatTile
        label="میانگین تأخیر"
        value={`${faNum(kpis.avgDelayDays, true)} روز`}
        hint={kpis.pendingReview ? `${faNum(kpis.pendingReview)} در انتظار تأیید` : 'برای وظایف دیرکرددار'}
      />
    </div>
  );
}

export function NeedsAttentionList({ items, limit = 10 }: { items: NeedsAttentionItem[]; limit?: number }) {
  if (!items.length) {
    return <p className="rounded-md bg-success-soft px-3 py-3 text-sm text-success">موردی نیازمند توجه فوری نیست.</p>;
  }
  return (
    <ul className="-mx-3 divide-y divide-border/60">
      {items.slice(0, limit).map(({ task, reasons }) => (
        <li key={task.id}>
          <Link
            href={`/tasks/${task.id}`}
            className="flex flex-col gap-2 rounded-lg px-3 py-2.5 hover:bg-muted/60 sm:flex-row sm:items-center"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar name={task.primaryOwner.fullName} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  <span className="me-2 text-[11px] font-normal tabular text-muted-foreground">{task.code}</span>
                  {task.title}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                  <span>{task.primaryOwner.fullName}</span>
                  <PriorityBadge priority={task.priority} />
                  <DeadlineText deadline={task.deadline} done={task.status === 'COMPLETED'} />
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 sm:justify-end">
              {reasons.map((r) => {
                const s = REASON_STYLE[r] ?? { variant: 'neutral' as const, icon: null };
                const Icon = s.icon;
                return (
                  <Badge key={r} variant={s.variant}>
                    {Icon && <Icon />}
                    {ATTENTION_REASON_LABELS[r]}
                  </Badge>
                );
              })}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function WorkloadBars({ rows, limit = 12 }: { rows: WorkloadRow[]; limit?: number }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">داده‌ای وجود ندارد.</p>;
  return (
    <div className="grid gap-3">
      <HBarList
        rows={rows.slice(0, limit).map((r) => ({
          key: r.employee.id,
          label: (
            <span className="inline-flex items-center gap-1.5">
              {r.employee.fullName}
              {r.onLeave && <Badge variant="neutral">مرخصی</Badge>}
            </span>
          ),
          value: r.load,
          tone: r.state === 'OVERLOADED' ? 'alert' : 'default',
          hint:
            r.state !== 'BALANCED' ? (
              <Badge variant={r.state === 'OVERLOADED' ? 'warning' : 'info'}>{WORKLOAD_STATE_LABELS[r.state]}</Badge>
            ) : undefined,
        }))}
        format={(v) => `${faNum(v)} واحد`}
      />
      <p className="text-[11px] leading-5 text-muted-foreground">
        بار کاری = مجموع وزن اولویت وظایف باز (کم ۱، عادی ۲، بالا ۳، فوری ۴). «بار کاری بالا» یعنی دست‌کم ۱٫۵ برابر
        میانگین گروه — صرفاً برای توزیع بهتر کار، نه ارزیابی عملکرد.
      </p>
    </div>
  );
}

export function StatusDistribution({ byStatus }: { byStatus: Record<TaskStatus, number> }) {
  return (
    <StackedBar
      segments={[
        { label: TASK_STATUS_LABELS.NOT_STARTED, value: byStatus.NOT_STARTED, color: 'var(--color-series-1)' },
        { label: TASK_STATUS_LABELS.IN_PROGRESS, value: byStatus.IN_PROGRESS, color: 'var(--color-series-3)' },
        { label: TASK_STATUS_LABELS.WAITING, value: byStatus.WAITING, color: 'var(--color-series-4)' },
        { label: TASK_STATUS_LABELS.BLOCKED, value: byStatus.BLOCKED, color: 'var(--color-series-2)' },
      ]}
    />
  );
}

export function PriorityCounts({ byPriority }: { byPriority: Record<TaskPriority, number> }) {
  return (
    <div className="flex flex-wrap gap-4 text-sm">
      {(['URGENT', 'HIGH', 'NORMAL', 'LOW'] as TaskPriority[]).map((p) => (
        <span key={p} className="inline-flex items-center gap-2">
          <PriorityBadge priority={p} />
          <span className="font-semibold tabular">{faNum(byPriority[p])}</span>
        </span>
      ))}
    </div>
  );
}

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">فعالیتی ثبت نشده است.</p>;
  return (
    <ul className="grid gap-3">
      {items.map((a) => (
        <li key={a.id} className="flex gap-3 text-sm">
          <Avatar name={a.actor?.fullName ?? 'سیستم'} className="size-7 text-[10px]" />
          <div className="min-w-0">
            <p className="leading-6">
              <span className="font-medium">{a.actor?.fullName ?? 'سیستم'}</span>{' '}
              <span className="text-muted-foreground">{TASK_EVENT_LABELS[a.eventType]}</span>
            </p>
            <Link href={`/tasks/${a.task.id}`} className="block truncate text-xs text-primary hover:underline">
              {a.task.code} — {a.task.title}
            </Link>
            <p className="text-[11px] text-muted-foreground">{timeAgo(a.createdAt)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function BlockerHotspots({ items }: { items: BlockerHotspot[] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">مانع بازی وجود ندارد.</p>;
  return (
    <HBarList
      rows={items.map((b) => ({
        key: b.label,
        label: b.label,
        value: b.openBlockers,
        tone: 'alert',
        hint: <span className="text-[11px]">· میانگین {faNum(b.avgOpenDays, true)} روز</span>,
      }))}
      format={(v) => `${faNum(v)} مانع`}
    />
  );
}

export function DelayReasonBars({ items }: { items: DelayReasonStat[] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">در این دوره دلیل تأخیری ثبت نشده است.</p>;
  return (
    <HBarList
      rows={items.map((d) => ({
        key: d.reasonType,
        label: DELAY_REASON_LABELS[d.reasonType],
        value: d.count,
      }))}
    />
  );
}
