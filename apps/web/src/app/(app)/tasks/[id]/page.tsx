'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Ban,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileWarning,
  Gauge,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Undo2,
  UserRoundCog,
  Users,
  XCircle,
} from 'lucide-react';
import {
  BLOCKER_TYPE_LABELS,
  DELAY_REASON_LABELS,
  RECURRENCE_LABELS,
  REVIEW_STATUS_LABELS,
  RISK_LEVEL_LABELS,
  type SubtaskDto,
  type TaskDetail,
} from '@karban/shared';
import { Button } from '@/components/ui/button';
import {
  Avatar,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  ProgressBar,
} from '@/components/ui/primitives';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { DatePicker } from '@/components/ui/date-picker';
import { ErrorState, Spinner } from '@/components/ui/layout';
import { ConfidentialMark, DeadlineText, PriorityBadge, RiskBadge, StatusBadge } from '@/components/tasks/badges';
import {
  CollaboratorsDialog,
  CompleteDialog,
  DelayReasonDialog,
  ProgressDialog,
  ReasonDialog,
  ReassignDialog,
  StatusDialog,
} from '@/components/tasks/task-actions';
import { Timeline } from '@/components/tasks/timeline';
import { EmployeePicker } from '@/components/tasks/employee-picker';
import { api, del, errorMessage, get, patch, post } from '@/lib/api';
import { useInvalidateTasks, useSession, useSettings } from '@/lib/queries';
import { cn, faNum, formatBytes, formatDate, formatDateTime, timeAgo } from '@/lib/utils';

type DialogKind =
  'status' | 'block' | 'progress' | 'complete' | 'delay' | 'reopen' | 'cancel' | 'reassign' | 'collaborators' | null;

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['task', id], queryFn: () => get<TaskDetail>(`/tasks/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  return q.data ? <TaskView task={q.data} /> : null;
}

function TaskView({ task }: { task: TaskDetail }) {
  const me = useSession();
  const invalidate = useInvalidateTasks();
  const [dialog, setDialog] = React.useState<DialogKind>(null);
  const p = task.permissions;
  const open = task.status !== 'COMPLETED' && task.status !== 'CANCELLED';
  const isOwner = task.primaryOwner.id === me.employee.id;
  const openBlockers = task.blockers.filter((b) => b.status === 'OPEN');

  const accept = useMutation({
    mutationFn: () => post(`/tasks/${task.id}/accept`),
    onSuccess: async () => {
      await invalidate();
      toast.success('تکمیل وظیفه تأیید شد.');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const start = useMutation({
    mutationFn: () => post(`/tasks/${task.id}/status`, { status: 'IN_PROGRESS', version: task.version }),
    onSuccess: async () => {
      await invalidate();
      toast.success('کار روی وظیفه شروع شد.');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const resolve = useMutation({
    mutationFn: (blockerId: string) => post(`/blockers/${blockerId}/resolve`, {}),
    onSuccess: async () => {
      await invalidate();
      toast.success('مانع برطرف شد.');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const dialogProps = (kind: DialogKind) => ({
    task,
    open: dialog === kind,
    onOpenChange: (o: boolean) => setDialog(o ? kind : null),
  });

  return (
    <div className="grid gap-5">
      {/* ---------------------------------------------------------- header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Link href="/tasks" className="hover:text-foreground">
              وظایف
            </Link>
            <span>/</span>
            <span className="tabular">{task.code}</span>
            {task.confidential && <ConfidentialMark />}
          </div>
          <h1
            className={cn(
              'text-xl font-bold leading-snug sm:text-2xl',
              task.status === 'CANCELLED' && 'line-through text-muted-foreground',
            )}
          >
            {task.title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            <DeadlineText deadline={task.deadline} done={!open} />
            <RiskBadge risk={task.risk} />
            {task.reviewStatus !== 'NONE' && (
              <Badge variant={task.reviewStatus === 'ACCEPTED' ? 'success' : 'warning'}>
                {REVIEW_STATUS_LABELS[task.reviewStatus]}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {open && p.canWork && task.status === 'NOT_STARTED' && (
            <Button onClick={() => start.mutate()} loading={start.isPending}>
              <Play /> شروع کار
            </Button>
          )}
          {open && p.canWork && (
            <Button variant="outline" onClick={() => setDialog('progress')}>
              <Gauge /> ثبت پیشرفت
            </Button>
          )}
          {open && p.canWork && (
            <Button variant="outline" onClick={() => setDialog('status')}>
              <ClipboardCheck /> تغییر وضعیت
            </Button>
          )}
          {open && p.canComplete && (
            <Button
              variant={task.status === 'NOT_STARTED' ? 'outline' : 'default'}
              onClick={() => setDialog('complete')}
            >
              <CheckCircle2 /> تکمیل وظیفه
            </Button>
          )}
          {p.canReview && (
            <Button onClick={() => accept.mutate()} loading={accept.isPending}>
              <CheckCircle2 /> تأیید تکمیل
            </Button>
          )}
          {(p.canEdit || p.canManage || p.canReopen || p.canCancel || (p.canWork && open)) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="عملیات بیشتر">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {p.canEdit && (
                  <DropdownMenuItem asChild>
                    <Link href={`/tasks/${task.id}/edit`}>
                      <Pencil /> ویرایش جزئیات
                    </Link>
                  </DropdownMenuItem>
                )}
                {open && p.canManage && (
                  <DropdownMenuItem onSelect={() => setDialog('reassign')}>
                    <UserRoundCog /> تغییر مسئول اصلی
                  </DropdownMenuItem>
                )}
                {open && (p.canManage || isOwner) && (
                  <DropdownMenuItem onSelect={() => setDialog('collaborators')}>
                    <Users /> مدیریت همکاران
                  </DropdownMenuItem>
                )}
                {open && p.canWork && (
                  <DropdownMenuItem onSelect={() => setDialog('block')}>
                    <Ban /> ثبت مانع
                  </DropdownMenuItem>
                )}
                {(task.isOverdue || task.delayReasonRequired) && (isOwner || p.canManage) && (
                  <DropdownMenuItem onSelect={() => setDialog('delay')}>
                    <FileWarning /> ثبت دلیل تأخیر
                  </DropdownMenuItem>
                )}
                {(p.canReopen || p.canCancel) && <DropdownMenuSeparator />}
                {p.canReopen && (
                  <DropdownMenuItem onSelect={() => setDialog('reopen')}>
                    <RotateCcw /> بازگشایی
                  </DropdownMenuItem>
                )}
                {p.canCancel && (
                  <DropdownMenuItem destructive onSelect={() => setDialog('cancel')}>
                    <XCircle /> لغو وظیفه
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------------- alerts */}
      {task.delayReasonRequired && (
        <Banner
          tone="danger"
          icon={<FileWarning />}
          title={`این وظیفه ${faNum(task.delayDays)} روز تأخیر دارد و دلیل تأخیر ثبت نشده است.`}
        >
          {(isOwner || p.canManage) && (
            <Button size="sm" variant="destructive" onClick={() => setDialog('delay')}>
              ثبت دلیل تأخیر
            </Button>
          )}
        </Banner>
      )}
      {p.canReview && (
        <Banner
          tone="warning"
          icon={<ClipboardCheck />}
          title={`${task.primaryOwner.fullName} این وظیفه را تکمیل کرده و منتظر بررسی شماست.`}
        >
          <Button size="sm" onClick={() => accept.mutate()} loading={accept.isPending}>
            تأیید
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDialog('reopen')}>
            <Undo2 /> بازگشایی
          </Button>
        </Banner>
      )}
      {openBlockers.map((b) => (
        <Banner
          key={b.id}
          tone="danger"
          icon={<Ban />}
          title={`مانع: ${BLOCKER_TYPE_LABELS[b.type]}`}
          description={
            <>
              {b.description}
              {(b.blockingDepartment || b.blockingEmployee || b.blockingPartyNote) && (
                <span className="block text-xs opacity-80">
                  وابسته به:{' '}
                  {[b.blockingDepartment?.name, b.blockingEmployee?.fullName, b.blockingPartyNote]
                    .filter(Boolean)
                    .join('، ')}
                  {b.expectedResolutionAt && ` · رفع تخمینی: ${formatDate(b.expectedResolutionAt)}`}
                </span>
              )}
            </>
          }
        >
          {p.canWork && (
            <Button size="sm" variant="outline" onClick={() => resolve.mutate(b.id)} loading={resolve.isPending}>
              برطرف شد
            </Button>
          )}
        </Banner>
      ))}

      {/* ---------------------------------------------------------- body */}
      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="grid min-w-0 content-start gap-5">
          <Card>
            <CardHeader>
              <CardTitle>شرح وظیفه</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-line text-sm leading-8">{task.description}</p>
              {task.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {task.tags.map((t) => (
                    <Link key={t} href={`/tasks?tag=${encodeURIComponent(t)}&status=all`}>
                      <Badge variant="outline">#{t}</Badge>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Subtasks task={task} />
          <Attachments task={task} />
          <Card>
            <CardContent className="pt-5">
              <Timeline task={task} />
            </CardContent>
          </Card>
        </div>

        <aside className="grid content-start gap-5">
          <Card>
            <CardContent className="grid gap-3 pt-5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">پیشرفت</span>
                <span className="text-lg font-semibold tabular">{faNum(task.progress)}٪</span>
              </div>
              <ProgressBar
                value={task.progress}
                tone={task.isOverdue ? 'danger' : task.status === 'COMPLETED' ? 'success' : 'primary'}
              />
              {task.subtaskCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  {faNum(task.subtaskDoneCount)} از {faNum(task.subtaskCount)} زیروظیفه تکمیل شده
                </p>
              )}
            </CardContent>
          </Card>

          {task.risk && open && (
            <Card
              className={cn(
                task.risk.level === 'HIGH' && 'border-danger/40',
                task.risk.level === 'MEDIUM' && 'border-warning/40',
              )}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ShieldAlert className="size-4" /> {RISK_LEVEL_LABELS[task.risk.level]}
                  <span className="text-xs font-normal text-muted-foreground">({faNum(task.risk.score)} از ۱۰۰)</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {task.risk.factors.length ? (
                  <ul className="grid gap-1.5 text-sm">
                    {task.risk.factors.map((f) => (
                      <li key={f.code + f.label} className="flex items-start justify-between gap-2">
                        <span>{f.label}</span>
                        <span className="text-xs tabular text-muted-foreground">+{faNum(f.points)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">نشانه‌ای از خطر تأخیر دیده نمی‌شود.</p>
                )}
                <p className="mt-3 text-[11px] text-muted-foreground">
                  ارزیابی خودکار وضعیت وظیفه — نه ارزیابی عملکرد افراد. به‌روزرسانی {timeAgo(task.risk.assessedAt)}
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="grid gap-4 pt-5 text-sm">
              <Person label="مسئول اصلی" name={task.primaryOwner.fullName} sub={task.primaryOwner.jobTitle} />
              {task.collaborators.length > 0 && (
                <div>
                  <p className="mb-2 text-xs text-muted-foreground">همکاران</p>
                  <div className="grid gap-2">
                    {task.collaborators.map((c) => (
                      <Person key={c.id} name={c.fullName} sub={c.jobTitle} />
                    ))}
                  </div>
                </div>
              )}
              <Person label="مدیر وظیفه" name={task.manager.fullName} sub={task.manager.jobTitle} />
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 border-t pt-4">
                <Meta label="دپارتمان">{task.department.name}</Meta>
                {task.project && <Meta label="پروژه">{task.project.name}</Meta>}
                {task.category && <Meta label="دسته‌بندی">{task.category}</Meta>}
                <Meta label="شروع">{formatDate(task.startDate)}</Meta>
                <Meta label="مهلت">{formatDateTime(task.deadline)}</Meta>
                {task.completedAt && <Meta label="تکمیل">{formatDateTime(task.completedAt)}</Meta>}
                {task.estimatedEffortHours && <Meta label="برآورد">{faNum(task.estimatedEffortHours, true)} ساعت</Meta>}
                <Meta label="ایجاد">{`${task.creator.fullName} · ${formatDate(task.createdAt)}`}</Meta>
                <Meta label="آخرین فعالیت">{timeAgo(task.lastActivityAt)}</Meta>
                {task.recurrence && (
                  <Meta label="تکرار">
                    <Link href="/recurring" className="text-primary hover:underline">
                      {RECURRENCE_LABELS[task.recurrence.frequency]}
                      {task.recurrence.active ? '' : ' (متوقف)'}
                    </Link>
                  </Meta>
                )}
              </dl>
            </CardContent>
          </Card>

          {task.delayReasons.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">دلایل تأخیر</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                {task.delayReasons.map((d) => (
                  <div key={d.id}>
                    <p className="font-medium">{DELAY_REASON_LABELS[d.reasonType]}</p>
                    {d.description && <p className="text-muted-foreground">{d.description}</p>}
                    <p className="text-xs text-muted-foreground">
                      {d.createdBy?.fullName} · {formatDate(d.createdAt)} · برای مهلت {formatDate(d.deadlineAt)}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {task.blockers.some((b) => b.status === 'RESOLVED') && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">موانع برطرف‌شده</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                {task.blockers
                  .filter((b) => b.status === 'RESOLVED')
                  .map((b) => (
                    <div key={b.id}>
                      <p>{b.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(b.createdAt)} تا {formatDate(b.resolvedAt)}
                        {b.resolutionNote && ` · ${b.resolutionNote}`}
                      </p>
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}
        </aside>
      </div>

      <StatusDialog {...dialogProps('status')} />
      <StatusDialog {...dialogProps('block')} initial="BLOCKED" />
      <ProgressDialog {...dialogProps('progress')} />
      <CompleteDialog {...dialogProps('complete')} />
      <DelayReasonDialog {...dialogProps('delay')} />
      <ReasonDialog {...dialogProps('reopen')} kind="reopen" />
      <ReasonDialog {...dialogProps('cancel')} kind="cancel" />
      <ReassignDialog {...dialogProps('reassign')} />
      <CollaboratorsDialog {...dialogProps('collaborators')} />
    </div>
  );
}

function Banner({
  tone,
  icon,
  title,
  description,
  children,
}: {
  tone: 'danger' | 'warning';
  icon: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
        tone === 'danger'
          ? 'border-danger/30 bg-danger-soft text-danger'
          : 'border-warning/30 bg-warning-soft text-warning',
      )}
    >
      <div className="flex items-start gap-3 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0">
        {icon}
        <div className="text-sm">
          <p className="font-medium">{title}</p>
          {description && <div className="mt-0.5 leading-6 opacity-90">{description}</div>}
        </div>
      </div>
      {children && <div className="flex shrink-0 gap-2">{children}</div>}
    </div>
  );
}

function Person({ label, name, sub }: { label?: string; name: string; sub?: string | null }) {
  return (
    <div>
      {label && <p className="mb-2 text-xs text-muted-foreground">{label}</p>}
      <div className="flex items-center gap-2.5">
        <Avatar name={name} />
        <div className="min-w-0">
          <p className="truncate font-medium">{name}</p>
          {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

/* ---------------------------------------------------------------- subtasks */

function Subtasks({ task }: { task: TaskDetail }) {
  const me = useSession();
  const invalidate = useInvalidateTasks();
  const open = task.status !== 'COMPLETED' && task.status !== 'CANCELLED';
  const isLead = task.permissions.canManage || task.primaryOwner.id === me.employee.id;
  const [adding, setAdding] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [ownerId, setOwnerId] = React.useState<string | null>(task.primaryOwner.id);
  const [deadline, setDeadline] = React.useState<string | null>(null);
  const participants = new Set([task.primaryOwner.id, ...task.collaborators.map((c) => c.id)]);

  const add = useMutation({
    mutationFn: () =>
      post(`/tasks/${task.id}/subtasks`, { title, ownerId: ownerId ?? undefined, deadline: deadline ?? undefined }),
    onSuccess: async () => {
      setTitle('');
      setDeadline(null);
      setAdding(false);
      await invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = useMutation({
    mutationFn: (s: SubtaskDto) =>
      patch(`/subtasks/${s.id}`, { status: s.status === 'COMPLETED' ? 'IN_PROGRESS' : 'COMPLETED' }),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (s: SubtaskDto) => del(`/subtasks/${s.id}`),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!task.subtasks.length && !(open && isLead)) return null;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>
          زیروظایف{' '}
          {task.subtaskCount > 0 && (
            <span className="text-sm font-normal text-muted-foreground">
              ({faNum(task.subtaskDoneCount)}/{faNum(task.subtaskCount)})
            </span>
          )}
        </CardTitle>
        {open && isLead && !adding && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus /> افزودن
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid gap-1">
        {task.subtasks.map((s) => {
          const canToggle = open && (isLead || s.owner?.id === me.employee.id);
          return (
            <div key={s.id} className="group flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
              <Checkbox
                checked={s.status === 'COMPLETED'}
                disabled={!canToggle || toggle.isPending}
                onCheckedChange={() => toggle.mutate(s)}
                aria-label={s.title}
              />
              <span className={cn('flex-1 text-sm', s.status === 'COMPLETED' && 'text-muted-foreground line-through')}>
                {s.title}
              </span>
              {s.owner && <span className="hidden text-xs text-muted-foreground sm:inline">{s.owner.fullName}</span>}
              {s.deadline && <DeadlineText deadline={s.deadline} done={s.status === 'COMPLETED'} />}
              {open && isLead && (
                <button
                  onClick={() => remove.mutate(s)}
                  className="rounded p-1 text-muted-foreground opacity-0 hover:text-danger group-hover:opacity-100 focus:opacity-100 cursor-pointer"
                  aria-label={`حذف ${s.title}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          );
        })}
        {adding && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) add.mutate();
            }}
            className="mt-2 grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_12rem_11rem_auto]"
          >
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="عنوان زیروظیفه"
              autoFocus
              required
            />
            <EmployeePicker value={ownerId} onChange={setOwnerId} filter={(e) => participants.has(e.id)} />
            <DatePicker value={deadline} onChange={setDeadline} minToday clearable placeholder="مهلت (اختیاری)" />
            <div className="flex gap-2">
              <Button type="submit" size="md" loading={add.isPending}>
                افزودن
              </Button>
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                انصراف
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------- attachments */

function Attachments({ task }: { task: TaskDetail }) {
  const me = useSession();
  const settings = useSettings().data;
  const invalidate = useInvalidateTasks();
  const input = React.useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return api(`/tasks/${task.id}/attachments`, { method: 'POST', body });
    },
    onSuccess: async () => {
      await invalidate();
      toast.success('فایل پیوست شد.');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/attachments/${id}`),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const canUpload = task.permissions.canWork;
  if (!task.attachments.length && !canUpload) return null;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>پیوست‌ها</CardTitle>
        {canUpload && (
          <>
            <input
              ref={input}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.zip,.txt,.csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (settings && file.size > settings.attachmentMaxMb * 1024 * 1024) {
                  toast.error(`حداکثر حجم مجاز ${faNum(settings.attachmentMaxMb)} مگابایت است.`);
                } else upload.mutate(file);
                e.target.value = '';
              }}
            />
            <Button size="sm" variant="ghost" onClick={() => input.current?.click()} loading={upload.isPending}>
              <Paperclip /> افزودن فایل
            </Button>
          </>
        )}
      </CardHeader>
      <CardContent>
        {task.attachments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            فایلی پیوست نشده است. PDF، Word، Excel، تصویر و ZIP تا {faNum(settings?.attachmentMaxMb ?? 20)} مگابایت.
          </p>
        ) : (
          <ul className="grid gap-1">
            {task.attachments.map((a) => (
              <li key={a.id} className="group flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
                <Paperclip className="size-4 text-muted-foreground" />
                <a
                  href={`/api/attachments/${a.id}/download`}
                  className="min-w-0 flex-1 truncate text-sm hover:text-primary"
                >
                  {a.fileName}
                </a>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {formatBytes(a.size)} · {a.uploader?.fullName} · {timeAgo(a.createdAt)}
                </span>
                <a
                  href={`/api/attachments/${a.id}/download`}
                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                  aria-label={`دانلود ${a.fileName}`}
                >
                  <Download className="size-4" />
                </a>
                {(a.uploader?.id === me.employee.id || task.permissions.canManage) && task.permissions.canWork && (
                  <button
                    onClick={() => remove.mutate(a.id)}
                    className="rounded p-1 text-muted-foreground hover:text-danger cursor-pointer"
                    aria-label={`حذف ${a.fileName}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
