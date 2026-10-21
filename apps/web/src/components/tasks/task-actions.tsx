'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  BLOCKER_TYPE_LABELS,
  DELAY_REASON_LABELS,
  TASK_STATUS_LABELS,
  type BlockerType,
  type DelayReasonType,
  type TaskDetail,
  type TaskStatus,
} from '@karban/shared';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Label, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogFooter, Select } from '@/components/ui/overlays';
import { DatePicker } from '@/components/ui/date-picker';
import { ErrorState } from '@/components/ui/layout';
import { errorMessage, post, put } from '@/lib/api';
import { useDepartments, useInvalidateTasks } from '@/lib/queries';
import { faNum } from '@/lib/utils';
import { EmployeePicker, MultiEmployeePicker } from './employee-picker';

type DialogProps = { task: TaskDetail; open: boolean; onOpenChange: (o: boolean) => void };

/** Runs a task mutation, refreshes dependent queries and reports the outcome. */
function useTaskAction<TBody>(path: string, success: string, onDone: () => void, method: 'post' | 'put' = 'post') {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (body: TBody) => (method === 'put' ? put<TaskDetail>(path, body) : post<TaskDetail>(path, body)),
    onSuccess: async () => {
      await invalidate();
      toast.success(success);
      onDone();
    },
  });
}

const delayOptions = (Object.keys(DELAY_REASON_LABELS) as DelayReasonType[]).map((k) => ({
  value: k,
  label: DELAY_REASON_LABELS[k],
}));
const blockerOptions = (Object.keys(BLOCKER_TYPE_LABELS) as BlockerType[]).map((k) => ({
  value: k,
  label: BLOCKER_TYPE_LABELS[k],
}));

function DelayReasonFields({
  reason,
  setReason,
  description,
  setDescription,
}: {
  reason: string;
  setReason: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
}) {
  return (
    <>
      <Field label="دلیل تأخیر" required>
        <Select value={reason} onValueChange={setReason} options={delayOptions} placeholder="انتخاب دلیل" />
      </Field>
      <Field
        label="توضیح"
        required={reason === 'OTHER'}
        hint="توضیح، تحلیل علت تأخیر را برای مدیر و گزارش‌ها دقیق‌تر می‌کند."
      >
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
      </Field>
    </>
  );
}

/* ---------------------------------------------------------------- status & blocker */

export function StatusDialog({ task, open, onOpenChange, initial }: DialogProps & { initial?: TaskStatus }) {
  const [status, setStatus] = React.useState<TaskStatus>(
    initial ?? (task.status === 'NOT_STARTED' ? 'IN_PROGRESS' : task.status),
  );
  const [note, setNote] = React.useState('');
  const [blocker, setBlocker] = React.useState({
    type: 'WAITING_DEPARTMENT',
    description: '',
    blockingEmployeeId: null as string | null,
    blockingDepartmentId: '',
    blockingPartyNote: '',
    expectedResolutionAt: null as string | null,
  });
  const departments = useDepartments().data ?? [];
  const m = useTaskAction<object>(`/tasks/${task.id}/status`, 'وضعیت وظیفه به‌روزرسانی شد.', () => onOpenChange(false));
  const needsBlocker = status === 'BLOCKED' && !task.hasOpenBlocker;

  React.useEffect(() => {
    if (open) setStatus(initial ?? (task.status === 'NOT_STARTED' ? 'IN_PROGRESS' : task.status));
  }, [open, initial, task.status]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    m.mutate({
      status,
      version: task.version,
      note: note || undefined,
      blocker:
        status === 'BLOCKED' && blocker.description
          ? {
              type: blocker.type,
              description: blocker.description,
              blockingEmployeeId: blocker.blockingEmployeeId ?? undefined,
              blockingDepartmentId: blocker.blockingDepartmentId || undefined,
              blockingPartyNote: blocker.blockingPartyNote || undefined,
              expectedResolutionAt: blocker.expectedResolutionAt ?? undefined,
            }
          : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="تغییر وضعیت" description={task.title}>
        <form onSubmit={submit} className="grid gap-4">
          {m.error && <ErrorState message={errorMessage(m.error)} />}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(['NOT_STARTED', 'IN_PROGRESS', 'WAITING', 'BLOCKED'] as TaskStatus[]).map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => setStatus(s)}
                className={`rounded-lg border px-2 py-2 text-sm cursor-pointer ${status === s ? 'border-primary bg-accent font-medium text-accent-foreground' : 'hover:bg-muted'}`}
              >
                {TASK_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          {status === 'BLOCKED' && (
            <div className="grid gap-4 rounded-lg border border-danger/30 bg-danger-soft/40 p-4">
              <p className="text-sm font-medium text-danger">ثبت مانع — مدیر وظیفه بلافاصله مطلع می‌شود.</p>
              <Field label="نوع مانع" required>
                <Select
                  value={blocker.type}
                  onValueChange={(v) => setBlocker({ ...blocker, type: v })}
                  options={blockerOptions}
                />
              </Field>
              <Field label="شرح مانع" required={needsBlocker}>
                <Textarea
                  value={blocker.description}
                  onChange={(e) => setBlocker({ ...blocker, description: e.target.value })}
                  rows={2}
                  required={needsBlocker}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="واحد ایجادکننده مانع">
                  <Select
                    value={blocker.blockingDepartmentId}
                    onValueChange={(v) => setBlocker({ ...blocker, blockingDepartmentId: v })}
                    options={departments.map((d) => ({ value: d.id, label: d.name }))}
                    allowClear
                    clearLabel="—"
                    placeholder="—"
                  />
                </Field>
                <Field label="فرد ایجادکننده مانع">
                  <EmployeePicker
                    value={blocker.blockingEmployeeId}
                    onChange={(id) => setBlocker({ ...blocker, blockingEmployeeId: id })}
                    placeholder="—"
                    clearable
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="طرف بیرونی" hint="مثلاً تأمین‌کننده یا مشتری">
                  <Input
                    value={blocker.blockingPartyNote}
                    onChange={(e) => setBlocker({ ...blocker, blockingPartyNote: e.target.value })}
                  />
                </Field>
                <Field label="زمان تخمینی رفع">
                  <DatePicker
                    value={blocker.expectedResolutionAt}
                    onChange={(v) => setBlocker({ ...blocker, expectedResolutionAt: v })}
                    minToday
                    clearable
                  />
                </Field>
              </div>
            </div>
          )}
          <Field label="یادداشت (اختیاری)">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="توضیح کوتاه برای مدیر و همکاران"
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              انصراف
            </Button>
            <Button type="submit" loading={m.isPending} variant={status === 'BLOCKED' ? 'destructive' : 'default'}>
              ثبت وضعیت
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- progress */

export function ProgressDialog({ task, open, onOpenChange }: DialogProps) {
  const [progress, setProgress] = React.useState(task.progress);
  const [comment, setComment] = React.useState('');
  const m = useTaskAction<object>(`/tasks/${task.id}/progress`, 'پیشرفت ثبت شد.', () => onOpenChange(false));
  React.useEffect(() => {
    if (open) setProgress(task.progress);
  }, [open, task.progress]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="ثبت پیشرفت" description={task.title} size="sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate({ progress, comment: comment || undefined, version: task.version });
          }}
          className="grid gap-4"
        >
          {m.error && <ErrorState message={errorMessage(m.error)} />}
          <div className="text-center text-4xl font-semibold tabular">{faNum(progress)}٪</div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={progress}
            onChange={(e) => setProgress(Number(e.target.value))}
            className="w-full accent-[var(--color-primary)]"
            aria-label="درصد پیشرفت"
          />
          <div className="flex justify-between gap-1">
            {[0, 25, 50, 75, 90].map((v) => (
              <Button
                key={v}
                type="button"
                size="sm"
                variant={progress === v ? 'default' : 'outline'}
                onClick={() => setProgress(v)}
              >
                {faNum(v)}٪
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">برای پایان کار از دکمه «تکمیل وظیفه» استفاده کنید.</p>
          <Field label="توضیح (اختیاری)">
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              انصراف
            </Button>
            <Button type="submit" loading={m.isPending}>
              ذخیره
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- complete / delay */

export function CompleteDialog({ task, open, onOpenChange }: DialogProps) {
  const late = new Date(task.deadline) < new Date();
  const needsReason = late && !task.delayReasons.some((d) => d.deadlineAt === task.deadline);
  const [note, setNote] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [description, setDescription] = React.useState('');
  const m = useTaskAction<object>(`/tasks/${task.id}/complete`, 'وظیفه تکمیل شد.', () => onOpenChange(false));
  const openSubtasks = task.subtasks.filter((s) => s.status !== 'COMPLETED').length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="تکمیل وظیفه" description={task.title}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate({
              version: task.version,
              note: note || undefined,
              delayReason: needsReason ? { reasonType: reason, description: description || undefined } : undefined,
            });
          }}
          className="grid gap-4"
        >
          {m.error && <ErrorState message={errorMessage(m.error)} />}
          {openSubtasks > 0 && (
            <div className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
              {faNum(openSubtasks)} زیروظیفه هنوز تکمیل نشده است.
            </div>
          )}
          {task.requiresReview && (
            <p className="text-sm text-muted-foreground">پس از تکمیل، مدیر وظیفه نتیجه را بررسی و تأیید می‌کند.</p>
          )}
          {needsReason && (
            <div className="grid gap-4 rounded-lg border border-danger/30 bg-danger-soft/40 p-4">
              <p className="text-sm font-medium text-danger">مهلت این وظیفه گذشته است؛ ثبت دلیل تأخیر الزامی است.</p>
              <DelayReasonFields
                reason={reason}
                setReason={setReason}
                description={description}
                setDescription={setDescription}
              />
            </div>
          )}
          <Field label="گزارش پایان کار (اختیاری)">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="نتیجه، خروجی یا نکات تحویل"
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              انصراف
            </Button>
            <Button
              type="submit"
              loading={m.isPending}
              disabled={needsReason && (!reason || (reason === 'OTHER' && !description.trim()))}
            >
              تکمیل وظیفه
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DelayReasonDialog({ task, open, onOpenChange }: DialogProps) {
  const [reason, setReason] = React.useState('');
  const [description, setDescription] = React.useState('');
  const m = useTaskAction<object>(`/tasks/${task.id}/delay-reasons`, 'دلیل تأخیر ثبت شد.', () => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="ثبت دلیل تأخیر" description={task.title}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate({ reasonType: reason, description: description || undefined });
          }}
          className="grid gap-4"
        >
          {m.error && <ErrorState message={errorMessage(m.error)} />}
          <DelayReasonFields
            reason={reason}
            setReason={setReason}
            description={description}
            setDescription={setDescription}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              انصراف
            </Button>
            <Button
              type="submit"
              loading={m.isPending}
              disabled={!reason || (reason === 'OTHER' && !description.trim())}
            >
              ثبت
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- manager actions */

export function ReasonDialog({ task, open, onOpenChange, kind }: DialogProps & { kind: 'reopen' | 'cancel' }) {
  const [reason, setReason] = React.useState('');
  const [deadline, setDeadline] = React.useState<string | null>(null);
  const m = useTaskAction<object>(
    `/tasks/${task.id}/${kind}`,
    kind === 'reopen' ? 'وظیفه بازگشایی شد.' : 'وظیفه لغو شد.',
    () => onOpenChange(false),
  );
  const past = new Date(task.deadline) < new Date();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={kind === 'reopen' ? 'بازگشایی وظیفه' : 'لغو وظیفه'} description={task.title}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate({ reason, version: task.version, ...(kind === 'reopen' && deadline ? { deadline } : {}) });
          }}
          className="grid gap-4"
        >
          {m.error && <ErrorState message={errorMessage(m.error)} />}
          <Field label="دلیل" required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} required />
          </Field>
          {kind === 'reopen' && (
            <Field
              label="مهلت جدید"
              hint={past ? 'مهلت فعلی گذشته است؛ بهتر است مهلت جدید تعیین کنید.' : 'در صورت نیاز'}
            >
              <DatePicker value={deadline} onChange={setDeadline} withTime minToday clearable />
            </Field>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              انصراف
            </Button>
            <Button
              type="submit"
              loading={m.isPending}
              variant={kind === 'cancel' ? 'destructive' : 'default'}
              disabled={!reason.trim()}
            >
              {kind === 'reopen' ? 'بازگشایی' : 'لغو وظیفه'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ReassignDialog({ task, open, onOpenChange }: DialogProps) {
  const [ownerId, setOwnerId] = React.useState<string | null>(null);
  const [keep, setKeep] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const m = useTaskAction<object>(`/tasks/${task.id}/reassign`, 'مسئول وظیفه تغییر کرد.', () => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="تغییر مسئول اصلی" description={`مسئول فعلی: ${task.primaryOwner.fullName}`}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (ownerId)
              m.mutate({
                primaryOwnerId: ownerId,
                keepPreviousAsCollaborator: keep,
                reason: reason || undefined,
                version: task.version,
              });
          }}
          className="grid gap-4"
        >
          {m.error && <ErrorState message={errorMessage(m.error)} />}
          <Field label="مسئول جدید" required>
            <EmployeePicker
              value={ownerId}
              onChange={setOwnerId}
              filter={(e) => e.assignable && e.id !== task.primaryOwner.id}
            />
          </Field>
          <div className="flex items-center gap-2">
            <Checkbox id="keep" checked={keep} onCheckedChange={(v) => setKeep(v === true)} />
            <Label htmlFor="keep" className="font-normal">
              مسئول قبلی به‌عنوان همکار باقی بماند
            </Label>
          </div>
          <Field label="دلیل (اختیاری)">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              انصراف
            </Button>
            <Button type="submit" loading={m.isPending} disabled={!ownerId}>
              تغییر مسئول
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CollaboratorsDialog({ task, open, onOpenChange }: DialogProps) {
  const [ids, setIds] = React.useState<string[]>(task.collaborators.map((c) => c.id));
  const m = useTaskAction<object>(
    `/tasks/${task.id}/collaborators`,
    'همکاران به‌روزرسانی شدند.',
    () => onOpenChange(false),
    'put',
  );
  React.useEffect(() => {
    if (open) setIds(task.collaborators.map((c) => c.id));
  }, [open, task.collaborators]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="همکاران وظیفه"
        description="همکاران وظیفه را می‌بینند، به‌روزرسانی می‌کنند و اعلان دریافت می‌کنند."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate({ employeeIds: ids });
          }}
          className="grid gap-4"
        >
          {m.error && <ErrorState message={errorMessage(m.error)} />}
          <MultiEmployeePicker value={ids} onChange={setIds} filter={(e) => e.id !== task.primaryOwner.id} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              انصراف
            </Button>
            <Button type="submit" loading={m.isPending}>
              ذخیره
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
