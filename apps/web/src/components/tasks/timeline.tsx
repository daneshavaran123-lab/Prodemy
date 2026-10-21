'use client';

import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AtSign, Gavel, MessageSquare, OctagonAlert, Send } from 'lucide-react';
import {
  COMMENT_KIND_LABELS,
  DELAY_REASON_LABELS,
  BLOCKER_TYPE_LABELS,
  TASK_EVENT_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type CommentKind,
  type EmployeeRef,
  type TaskDetail,
  type TimelineItem,
} from '@karban/shared';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Textarea } from '@/components/ui/primitives';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays';
import { ErrorState, Spinner } from '@/components/ui/layout';
import { errorMessage, get, post } from '@/lib/api';
import { useDirectory, useInvalidateTasks } from '@/lib/queries';
import { cn, faNum, formatDateTime, timeAgo } from '@/lib/utils';

type Names = (id: unknown) => string;

const asObj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const statusLabel = (v: unknown) => TASK_STATUS_LABELS[v as keyof typeof TASK_STATUS_LABELS] ?? String(v ?? '');

const FIELD_LABELS: Record<string, string> = {
  title: 'عنوان',
  description: 'شرح',
  category: 'دسته‌بندی',
  tags: 'برچسب‌ها',
  projectId: 'پروژه',
  startDate: 'تاریخ شروع',
  estimatedEffortHours: 'برآورد زمان',
  confidential: 'محرمانگی',
  requiresReview: 'نیاز به تأیید',
  departmentId: 'دپارتمان',
};

/** Human-readable sentence for a history event (PRD §32: who, when, old → new). */
function describe(item: TimelineItem, name: Names): React.ReactNode {
  const n = asObj(item.newValue);
  const o = item.oldValue;
  switch (item.eventType) {
    case 'STATUS_CHANGED':
      return (
        <>
          وضعیت از «{statusLabel(o)}» به «{statusLabel(item.newValue)}» تغییر کرد
        </>
      );
    case 'PROGRESS_CHANGED':
      return `پیشرفت از ${faNum(Number(o ?? 0))}٪ به ${faNum(Number(item.newValue ?? 0))}٪ رسید`;
    case 'PRIORITY_CHANGED':
      return `اولویت از «${TASK_PRIORITY_LABELS[o as 'LOW'] ?? o}» به «${TASK_PRIORITY_LABELS[item.newValue as 'LOW'] ?? item.newValue}» تغییر کرد`;
    case 'DEADLINE_CHANGED':
      return (
        <>
          مهلت از {formatDateTime(o as string)} به {formatDateTime(n.deadline as string)} تغییر کرد
          {n.note ? <span className="text-muted-foreground"> — {String(n.note)}</span> : null}
        </>
      );
    case 'REASSIGNED':
      return (
        <>
          مسئولیت از {name(o)} به {name(n.primaryOwnerId)} منتقل شد
          {n.reason ? <span className="text-muted-foreground"> — {String(n.reason)}</span> : null}
        </>
      );
    case 'MANAGER_CHANGED':
      return `مدیر وظیفه از ${name(o)} به ${name(item.newValue)} تغییر کرد`;
    case 'ASSIGNED':
      return `وظیفه به ${name(n.primaryOwnerId)} سپرده شد${(n.collaboratorIds as string[] | undefined)?.length ? ` (همکاران: ${(n.collaboratorIds as string[]).map(name).join('، ')})` : ''}`;
    case 'COLLABORATORS_CHANGED': {
      const added = (n.added as string[]) ?? [];
      const removed = (n.removed as string[]) ?? [];
      return (
        [
          added.length && `افزودن ${added.map(name).join('، ')}`,
          removed.length && `حذف ${removed.map(name).join('، ')}`,
        ]
          .filter(Boolean)
          .join(' · ') || TASK_EVENT_LABELS.COLLABORATORS_CHANGED
      );
    }
    case 'DETAILS_CHANGED':
      return `${FIELD_LABELS[item.field ?? ''] ?? item.field} ویرایش شد`;
    case 'BLOCKER_ADDED':
      return (
        <>
          مانع ثبت شد: {BLOCKER_TYPE_LABELS[n.type as 'OTHER'] ?? ''} — {String(n.description ?? '')}
        </>
      );
    case 'BLOCKER_RESOLVED':
      return `مانع برطرف شد${n.note ? ` — ${String(n.note)}` : ''}`;
    case 'DELAY_REASON_ADDED':
      return `دلیل تأخیر ثبت شد: ${DELAY_REASON_LABELS[n.reasonType as 'OTHER'] ?? ''}${n.description ? ` — ${String(n.description)}` : ''}`;
    case 'COMPLETED':
      return Number(n.delayDays) > 0 ? `وظیفه با ${faNum(Number(n.delayDays))} روز تأخیر تکمیل شد` : 'وظیفه تکمیل شد';
    case 'REOPENED':
      return `وظیفه بازگشایی شد${n.reason ? ` — ${String(n.reason)}` : ''}`;
    case 'CANCELLED':
      return `وظیفه لغو شد${n.reason ? ` — ${String(n.reason)}` : ''}`;
    case 'ATTACHMENT_ADDED':
      return `فایل «${String(n.fileName ?? '')}» پیوست شد`;
    case 'ATTACHMENT_REMOVED':
      return `فایل «${String(asObj(o).fileName ?? '')}» حذف شد`;
    case 'SUBTASK_ADDED':
      return `زیروظیفه «${String(n.title ?? '')}» اضافه شد`;
    case 'SUBTASK_UPDATED': {
      const old = asObj(o);
      if (n.status && n.status !== old.status)
        return `زیروظیفه «${String(old.title ?? '')}» ${n.status === 'COMPLETED' ? 'تکمیل شد' : `به وضعیت «${statusLabel(n.status)}» رفت`}`;
      return `زیروظیفه «${String(n.title ?? old.title ?? '')}» به‌روزرسانی شد`;
    }
    case 'SUBTASK_REMOVED':
      return `زیروظیفه «${String(asObj(o).title ?? '')}» حذف شد`;
    default:
      return item.eventType ? TASK_EVENT_LABELS[item.eventType] : '';
  }
}

const KIND_ICON: Record<CommentKind, React.ElementType> = {
  COMMENT: MessageSquare,
  DECISION: Gavel,
  BLOCKER_NOTE: OctagonAlert,
};

function Composer({ task, onPosted }: { task: TaskDetail; onPosted: () => void }) {
  const [content, setContent] = React.useState('');
  const [kind, setKind] = React.useState<CommentKind>('COMMENT');
  const [mentions, setMentions] = React.useState<EmployeeRef[]>([]);
  const involved = React.useMemo(() => {
    const map = new Map<string, EmployeeRef>();
    [task.primaryOwner, task.manager, task.creator, ...task.collaborators].forEach((e) => map.set(e.id, e));
    return [...map.values()];
  }, [task]);
  const m = useMutation({
    mutationFn: () => post(`/tasks/${task.id}/comments`, { content, kind, mentionIds: mentions.map((e) => e.id) }),
    onSuccess: () => {
      setContent('');
      setMentions([]);
      setKind('COMMENT');
      onPosted();
    },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (content.trim()) m.mutate();
      }}
      className="grid gap-2 rounded-lg border bg-card p-3"
    >
      {m.error && <ErrorState message={errorMessage(m.error)} />}
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={2}
        placeholder="نظر، تصمیم یا توضیح خود را بنویسید…"
        className="border-0 p-0 shadow-none focus-visible:ring-0"
        aria-label="متن نظر"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && content.trim()) m.mutate();
        }}
      />
      {mentions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {mentions.map((e) => (
            <Badge key={e.id} variant="primary">
              @{e.fullName}
              <button
                type="button"
                className="cursor-pointer"
                onClick={() => setMentions(mentions.filter((x) => x.id !== e.id))}
                aria-label="حذف"
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t pt-2">
        {(['COMMENT', 'DECISION', 'BLOCKER_NOTE'] as CommentKind[]).map((k) => {
          const Icon = KIND_ICON[k];
          return (
            <button
              type="button"
              key={k}
              onClick={() => setKind(k)}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs cursor-pointer',
                kind === k ? 'border-primary bg-accent text-accent-foreground' : 'hover:bg-muted',
              )}
            >
              <Icon className="size-3" /> {COMMENT_KIND_LABELS[k]}
            </button>
          );
        })}
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm">
              <AtSign /> اشاره به افراد
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-1">
            <p className="px-2 py-1.5 text-xs text-muted-foreground">فقط افراد مرتبط با این وظیفه</p>
            {involved.map((e) => (
              <button
                type="button"
                key={e.id}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted cursor-pointer"
                onClick={() => !mentions.some((x) => x.id === e.id) && setMentions([...mentions, e])}
              >
                <Avatar name={e.fullName} className="size-6 text-[10px]" /> {e.fullName}
              </button>
            ))}
          </PopoverContent>
        </Popover>
        <Button type="submit" size="sm" className="ms-auto" loading={m.isPending} disabled={!content.trim()}>
          <Send /> ارسال
        </Button>
      </div>
    </form>
  );
}

export function Timeline({ task }: { task: TaskDetail }) {
  const directory = useDirectory().data ?? [];
  const invalidate = useInvalidateTasks();
  const [filter, setFilter] = React.useState<'all' | 'comments'>('all');
  const q = useQuery({
    queryKey: ['timeline', task.id],
    queryFn: () => get<TimelineItem[]>(`/tasks/${task.id}/timeline`),
  });
  const people = new Map<string, string>([
    ...directory.map((e) => [e.id, e.fullName] as const),
    [task.primaryOwner.id, task.primaryOwner.fullName],
    [task.manager.id, task.manager.fullName],
  ]);
  const name: Names = (id) => people.get(String(id)) ?? 'یک همکار';
  const items = (q.data ?? []).filter((i) => filter === 'all' || i.type === 'comment');

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">گفتگو و تاریخچه</h2>
        <div className="flex gap-1 rounded-md bg-muted p-0.5 text-xs">
          {(
            [
              ['all', 'همه'],
              ['comments', 'فقط نظرات'],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              onClick={() => setFilter(v)}
              className={cn('rounded px-2 py-1 cursor-pointer', filter === v && 'bg-card shadow-sm')}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      {task.permissions.canComment && <Composer task={task} onPosted={invalidate} />}
      {q.isLoading && <Spinner />}
      <ol className="relative grid gap-4 border-s ps-5">
        {[...items].reverse().map((item) => (
          <li key={item.id} className="relative">
            <span
              className={cn(
                'absolute -start-[1.6rem] top-1.5 size-2.5 rounded-full ring-4 ring-background',
                item.type === 'comment' ? 'bg-primary' : 'bg-chart-axis',
              )}
            />
            {item.type === 'comment' && item.comment ? (
              <div
                className={cn(
                  'rounded-lg border bg-card p-3',
                  item.comment.kind === 'DECISION' && 'border-info/40',
                  item.comment.kind === 'BLOCKER_NOTE' && 'border-danger/40',
                )}
              >
                <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Avatar name={item.actor?.fullName ?? '؟'} className="size-6 text-[10px]" />
                  <span className="font-medium text-foreground">{item.actor?.fullName ?? 'سیستم'}</span>
                  {item.comment.kind !== 'COMMENT' && (
                    <Badge variant={item.comment.kind === 'DECISION' ? 'info' : 'danger'}>
                      {COMMENT_KIND_LABELS[item.comment.kind]}
                    </Badge>
                  )}
                  <span title={formatDateTime(item.createdAt)}>{timeAgo(item.createdAt)}</span>
                </div>
                <p className="whitespace-pre-line text-sm leading-7">{item.comment.content}</p>
                {item.comment.mentions.length > 0 && (
                  <p className="mt-1 text-xs text-primary">
                    {item.comment.mentions.map((m) => `@${m.fullName}`).join(' ')}
                  </p>
                )}
              </div>
            ) : (
              <div className="text-sm leading-7">
                <span className="font-medium">{item.actor?.fullName ?? 'سیستم'}</span>{' '}
                <span className="text-muted-foreground">·</span> <span>{describe(item, name)}</span>
                <span className="ms-2 text-xs text-muted-foreground" title={formatDateTime(item.createdAt)}>
                  {timeAgo(item.createdAt)}
                </span>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
