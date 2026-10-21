'use client';

import Link from 'next/link';
import { Ban, CheckCircle2, FileWarning, ListChecks, MessageSquare, Paperclip, Repeat } from 'lucide-react';
import type { TaskSummary } from '@karban/shared';
import { Avatar, ProgressBar, Tooltip } from '@/components/ui/primitives';
import { cn, faNum } from '@/lib/utils';
import { ConfidentialMark, DeadlineText, PriorityBadge, RiskBadge, StatusBadge } from './badges';

/** Compact task row for dashboards and lists; the whole row links to the task. */
export function TaskListItem({
  task,
  showOwner = true,
  extra,
}: {
  task: TaskSummary;
  showOwner?: boolean;
  extra?: React.ReactNode;
}) {
  const done = task.status === 'COMPLETED' || task.status === 'CANCELLED';
  return (
    <li>
      <Link
        href={`/tasks/${task.id}`}
        className="group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60"
      >
        {showOwner && (
          <Tooltip content={task.primaryOwner.fullName}>
            <span>
              <Avatar name={task.primaryOwner.fullName} className="mt-0.5" />
            </span>
          </Tooltip>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[11px] tabular text-muted-foreground">{task.code}</span>
            <span
              className={cn(
                'min-w-0 truncate text-sm font-medium group-hover:text-primary',
                task.status === 'CANCELLED' && 'line-through text-muted-foreground',
              )}
            >
              {task.title}
            </span>
            {task.confidential && <ConfidentialMark />}
            {task.recurrenceId && <Repeat className="size-3.5 text-muted-foreground" aria-label="تکراری" />}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            <DeadlineText deadline={task.deadline} done={done} />
            <RiskBadge risk={task.risk} compact />
            {task.delayReasonRequired && (
              <span className="inline-flex items-center gap-1 text-xs text-danger">
                <FileWarning className="size-3.5" /> دلیل تأخیر لازم است
              </span>
            )}
            {task.hasOpenBlocker && task.status !== 'BLOCKED' && (
              <span className="inline-flex items-center gap-1 text-xs text-danger">
                <Ban className="size-3.5" /> مانع باز
              </span>
            )}
            {showOwner && <span className="text-xs text-muted-foreground">{task.primaryOwner.fullName}</span>}
            {extra}
          </div>
        </div>
        <div className="hidden w-28 shrink-0 flex-col items-end gap-1.5 sm:flex">
          <span className="text-xs tabular text-muted-foreground">{faNum(task.progress)}٪</span>
          <ProgressBar
            value={task.progress}
            tone={task.isOverdue ? 'danger' : task.status === 'COMPLETED' ? 'success' : 'primary'}
          />
          <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {task.subtaskCount > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <ListChecks className="size-3" />
                {faNum(task.subtaskDoneCount)}/{faNum(task.subtaskCount)}
              </span>
            )}
            {task.commentCount > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <MessageSquare className="size-3" />
                {faNum(task.commentCount)}
              </span>
            )}
            {task.attachmentCount > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <Paperclip className="size-3" />
                {faNum(task.attachmentCount)}
              </span>
            )}
          </span>
        </div>
      </Link>
    </li>
  );
}

export function TaskList({
  tasks,
  empty = 'موردی وجود ندارد.',
  showOwner = true,
  limit,
  moreHref,
}: {
  tasks: TaskSummary[];
  empty?: string;
  showOwner?: boolean;
  limit?: number;
  moreHref?: string;
}) {
  if (!tasks.length) {
    return (
      <p className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4 text-success" /> {empty}
      </p>
    );
  }
  const shown = limit ? tasks.slice(0, limit) : tasks;
  return (
    <div>
      <ul className="-mx-3 divide-y divide-border/60">
        {shown.map((t) => (
          <TaskListItem key={t.id} task={t} showOwner={showOwner} />
        ))}
      </ul>
      {moreHref && limit && tasks.length > limit && (
        <Link href={moreHref} className="mt-2 block text-center text-sm text-primary hover:underline">
          مشاهده همه ({faNum(tasks.length)})
        </Link>
      )}
    </div>
  );
}
