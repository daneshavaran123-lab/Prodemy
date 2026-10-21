'use client';

import * as React from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Ban,
  CheckCircle2,
  ChevronsUp,
  CircleDashed,
  Clock,
  Lock,
  Minus,
  PauseCircle,
  PlayCircle,
  ShieldAlert,
} from 'lucide-react';
import {
  RISK_LEVEL_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type RiskAssessment,
  type TaskPriority,
  type TaskStatus,
} from '@karban/shared';
import { Badge, Tooltip } from '@/components/ui/primitives';
import { cn, faNum, formatDateTime, relativeDeadline } from '@/lib/utils';

const STATUS: Record<
  TaskStatus,
  { variant: 'neutral' | 'info' | 'warning' | 'danger' | 'success'; icon: React.ElementType }
> = {
  NOT_STARTED: { variant: 'neutral', icon: CircleDashed },
  IN_PROGRESS: { variant: 'info', icon: PlayCircle },
  WAITING: { variant: 'warning', icon: PauseCircle },
  BLOCKED: { variant: 'danger', icon: Ban },
  COMPLETED: { variant: 'success', icon: CheckCircle2 },
  CANCELLED: { variant: 'neutral', icon: Minus },
};

export function StatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <Badge variant={s.variant} className={cn(status === 'CANCELLED' && 'line-through', className)}>
      <Icon /> {TASK_STATUS_LABELS[status]}
    </Badge>
  );
}

const PRIORITY: Record<TaskPriority, { cls: string; icon: React.ElementType }> = {
  LOW: { cls: 'text-muted-foreground', icon: ArrowDown },
  NORMAL: { cls: 'text-info', icon: Minus },
  HIGH: { cls: 'text-warning', icon: ArrowUp },
  URGENT: { cls: 'text-danger', icon: ChevronsUp },
};

export function PriorityBadge({ priority, className }: { priority: TaskPriority; className?: string }) {
  const p = PRIORITY[priority];
  const Icon = p.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap', p.cls, className)}>
      <Icon className="size-3.5" /> {TASK_PRIORITY_LABELS[priority]}
    </span>
  );
}

/** Explainable risk (PRD §53): the tooltip lists every contributing factor. */
export function RiskBadge({ risk, compact }: { risk: RiskAssessment | null; compact?: boolean }) {
  if (!risk || risk.level === 'LOW') return null;
  const variant = risk.level === 'HIGH' ? 'danger' : 'warning';
  const Icon = risk.level === 'HIGH' ? ShieldAlert : AlertTriangle;
  return (
    <Tooltip
      content={
        <div>
          <p className="mb-1 font-semibold">
            {RISK_LEVEL_LABELS[risk.level]} (امتیاز {faNum(risk.score)} از ۱۰۰)
          </p>
          <ul className="list-disc ps-4">
            {risk.factors.map((f) => (
              <li key={f.code + f.label}>{f.label}</li>
            ))}
          </ul>
        </div>
      }
    >
      <span tabIndex={0}>
        <Badge variant={variant}>
          <Icon /> {compact ? (risk.level === 'HIGH' ? 'ریسک بالا' : 'ریسک') : RISK_LEVEL_LABELS[risk.level]}
        </Badge>
      </span>
    </Tooltip>
  );
}

export function DeadlineText({ deadline, done, className }: { deadline: string; done?: boolean; className?: string }) {
  if (done) {
    return <span className={cn('text-xs text-muted-foreground', className)}>{formatDateTime(deadline)}</span>;
  }
  const r = relativeDeadline(deadline);
  return (
    <Tooltip content={formatDateTime(deadline)}>
      <span
        tabIndex={0}
        className={cn(
          'inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap',
          { danger: 'text-danger', warning: 'text-warning', muted: 'text-muted-foreground' }[r.tone],
          className,
        )}
      >
        {r.tone === 'danger' ? <AlertOctagon className="size-3.5" /> : <Clock className="size-3.5" />}
        {r.text}
      </span>
    </Tooltip>
  );
}

export function ConfidentialMark() {
  return (
    <Tooltip content="محرمانه — فقط افراد مرتبط و مدیران مجاز می‌بینند">
      <span tabIndex={0} className="inline-flex text-muted-foreground" aria-label="محرمانه">
        <Lock className="size-3.5" />
      </span>
    </Tooltip>
  );
}
