'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Lightbulb, Lock, Repeat, Sparkles, Wand2 } from 'lucide-react';
import {
  RECURRENCE_LABELS,
  TASK_PRIORITY_LABELS,
  WEEKDAY_LABELS,
  WEEK_ORDER,
  type AiTaskDraft,
  type PrioritySuggestion,
  type RecurrenceFrequency,
  type TaskDetail,
  type TaskPriority,
} from '@karban/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  Input,
  Textarea,
} from '@/components/ui/primitives';
import { Select } from '@/components/ui/overlays';
import { DatePicker } from '@/components/ui/date-picker';
import { ErrorState } from '@/components/ui/layout';
import { ApiError, errorMessage, patch, post } from '@/lib/api';
import { useDepartments, useDirectory, useInvalidateTasks, useProjects, useSession } from '@/lib/queries';
import { cn, faPercent } from '@/lib/utils';
import { EmployeePicker, MultiEmployeePicker } from './employee-picker';

const PRIORITIES: TaskPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const PRIORITY_STYLE: Record<TaskPriority, string> = {
  LOW: 'data-[on=true]:border-muted-foreground data-[on=true]:bg-muted',
  NORMAL: 'data-[on=true]:border-info data-[on=true]:bg-info-soft data-[on=true]:text-info',
  HIGH: 'data-[on=true]:border-warning data-[on=true]:bg-warning-soft data-[on=true]:text-warning',
  URGENT: 'data-[on=true]:border-danger data-[on=true]:bg-danger-soft data-[on=true]:text-danger',
};

interface FormState {
  title: string;
  description: string;
  primaryOwnerId: string | null;
  collaboratorIds: string[];
  managerId: string | null;
  departmentId: string;
  startDate: string | null;
  deadline: string | null;
  priority: TaskPriority;
  category: string;
  tags: string;
  projectId: string;
  estimatedEffortHours: string;
  requiresReview: boolean;
  confidential: boolean;
  recurring: boolean;
  frequency: RecurrenceFrequency;
  interval: string;
  weekdays: number[];
  dayOfMonth: string;
  endDate: string | null;
  changeNote: string;
}

function initialState(meId: string, task?: TaskDetail): FormState {
  return {
    title: task?.title ?? '',
    description: task?.description ?? '',
    primaryOwnerId: task?.primaryOwner.id ?? meId,
    collaboratorIds: task?.collaborators.map((c) => c.id) ?? [],
    managerId: task?.manager.id ?? null,
    departmentId: task?.department.id ?? '',
    startDate: task?.startDate ?? new Date().toISOString(),
    deadline: task?.deadline ?? null,
    priority: task?.priority ?? 'NORMAL',
    category: task?.category ?? '',
    tags: task?.tags.join('، ') ?? '',
    projectId: task?.project?.id ?? '',
    estimatedEffortHours: task?.estimatedEffortHours ? String(task.estimatedEffortHours) : '',
    requiresReview: task?.requiresReview ?? false,
    confidential: task?.confidential ?? false,
    recurring: false,
    frequency: 'WEEKLY',
    interval: '1',
    weekdays: [],
    dayOfMonth: '',
    endDate: null,
    changeNote: '',
  };
}

/** AI-assisted entry (PRD §49): the draft only pre-fills the form; nothing is saved until the user submits. */
function AiDraftBox({ onDraft }: { onDraft: (d: AiTaskDraft) => void }) {
  const [text, setText] = React.useState('');
  const [draft, setDraft] = React.useState<AiTaskDraft | null>(null);
  const m = useMutation({
    mutationFn: () => post<AiTaskDraft>('/ai/parse-task', { text }),
    onSuccess: (d) => {
      setDraft(d);
      onDraft(d);
    },
  });
  return (
    <Card className="border-primary/25 bg-accent/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" /> ایجاد سریع با متن
        </CardTitle>
        <CardDescription>
          وظیفه را به زبان ساده بنویسید؛ مسئول، مهلت و اولویت استخراج و در فرم زیر قرار می‌گیرند. قبل از ثبت، همه چیز را
          بررسی کنید.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="مثال: گزارش فروش مهر را مهدی تا پنجشنبه آماده کند و اولویت بالا باشد."
          aria-label="متن وظیفه"
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => m.mutate()}
            loading={m.isPending}
            disabled={text.trim().length < 5}
          >
            <Wand2 /> تحلیل و پر کردن فرم
          </Button>
          {draft && (
            <span className="text-xs text-muted-foreground">
              {draft.source === 'ai' ? 'تحلیل با هوش مصنوعی' : 'تحلیل ساده متن (بدون هوش مصنوعی)'} · اطمینان{' '}
              {faPercent(draft.confidence)}
            </span>
          )}
        </div>
        {m.error && <ErrorState message={errorMessage(m.error)} />}
        {draft && draft.warnings.length > 0 && (
          <ul className="grid gap-1 text-xs text-warning">
            {draft.warnings.map((w) => (
              <li key={w} className="flex items-center gap-1.5">
                <AlertTriangle className="size-3.5" /> {w}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function TaskForm({ task }: { task?: TaskDetail }) {
  const router = useRouter();
  const me = useSession();
  const invalidate = useInvalidateTasks();
  const directory = useDirectory().data ?? [];
  const departments = useDepartments().data ?? [];
  const projects = useProjects().data ?? [];
  const [f, setF] = React.useState<FormState>(() => initialState(me.employee.id, task));
  const [suggestion, setSuggestion] = React.useState<PrioritySuggestion | null>(null);
  const [errors, setErrors] = React.useState<Partial<Record<keyof FormState, string>>>({});
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const isManager = me.scopes.taskManage !== 'self';
  const editing = !!task;
  const owner = directory.find((e) => e.id === f.primaryOwnerId);

  const suggest = useMutation({
    mutationFn: () =>
      post<PrioritySuggestion>('/ai/suggest-priority', {
        title: f.title,
        description: f.description || undefined,
        deadline: f.deadline ?? undefined,
        primaryOwnerId: f.primaryOwnerId ?? undefined,
      }),
    onSuccess: setSuggestion,
  });

  const save = useMutation({
    mutationFn: async () => {
      const tags = f.tags
        .split(/[,،]/)
        .map((t) => t.trim())
        .filter(Boolean);
      const common = {
        title: f.title.trim(),
        description: f.description.trim(),
        deadline: f.deadline,
        startDate: f.startDate ?? undefined,
        priority: f.priority,
        category: f.category.trim() || (editing ? null : undefined),
        tags,
        projectId: f.projectId || (editing ? null : undefined),
        estimatedEffortHours: f.estimatedEffortHours ? Number(f.estimatedEffortHours) : editing ? null : undefined,
        requiresReview: f.requiresReview,
        confidential: f.confidential,
        managerId: f.managerId ?? undefined,
        departmentId: f.departmentId || undefined,
      };
      if (editing) {
        return patch<TaskDetail>(`/tasks/${task.id}`, {
          ...common,
          version: task.version,
          changeNote: f.changeNote || undefined,
        });
      }
      return post<TaskDetail>('/tasks', {
        ...common,
        primaryOwnerId: f.primaryOwnerId,
        collaboratorIds: f.collaboratorIds,
        recurrence: f.recurring
          ? {
              frequency: f.frequency,
              interval: Number(f.interval) || 1,
              weekdays: f.frequency === 'WEEKLY' ? f.weekdays : undefined,
              dayOfMonth: f.frequency === 'MONTHLY' && f.dayOfMonth ? Number(f.dayOfMonth) : undefined,
              endDate: f.endDate
                ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date(f.endDate))
                : undefined,
            }
          : undefined,
      });
    },
    onSuccess: async (t) => {
      await invalidate();
      toast.success(editing ? 'تغییرات ذخیره شد.' : `وظیفه ${t.code} ایجاد شد.`);
      router.push(`/tasks/${t.id}`);
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!f.title.trim()) errs.title = 'عنوان الزامی است.';
    if (!f.description.trim()) errs.description = 'شرح وظیفه الزامی است.';
    if (!f.primaryOwnerId) errs.primaryOwnerId = 'مسئول اصلی را انتخاب کنید.';
    if (!f.deadline) errs.deadline = 'مهلت انجام الزامی است.';
    if (f.recurring && f.frequency === 'WEEKLY' && !f.weekdays.length)
      errs.weekdays = 'حداقل یک روز هفته را انتخاب کنید.';
    setErrors(errs);
    if (!Object.keys(errs).length) save.mutate();
  };

  const applyDraft = (d: AiTaskDraft) =>
    setF((s) => ({
      ...s,
      title: d.title || s.title,
      description: d.description || s.description,
      primaryOwnerId: d.primaryOwner?.id ?? s.primaryOwnerId,
      deadline: d.deadline ?? s.deadline,
      priority: d.priority,
      tags: d.tags.length ? d.tags.join('، ') : s.tags,
    }));

  const staleConflict = save.error instanceof ApiError && save.error.code === 'STALE_VERSION';

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      {!editing && me.permissions.includes('ai.use') && <AiDraftBox onDraft={applyDraft} />}

      <Card>
        <CardContent className="grid gap-5 pt-5">
          {save.error && (
            <ErrorState
              message={errorMessage(save.error)}
              onRetry={staleConflict ? () => router.refresh() : undefined}
            />
          )}
          <Field label="عنوان" htmlFor="title" required error={errors.title}>
            <Input
              id="title"
              value={f.title}
              onChange={(e) => set('title', e.target.value)}
              maxLength={200}
              aria-invalid={!!errors.title}
            />
          </Field>
          <Field
            label="شرح وظیفه"
            htmlFor="description"
            required
            error={errors.description}
            hint="انتظار، خروجی موردنظر و معیار پایان کار را روشن بنویسید."
          >
            <Textarea
              id="description"
              value={f.description}
              onChange={(e) => set('description', e.target.value)}
              rows={4}
              aria-invalid={!!errors.description}
            />
          </Field>

          <div className="grid gap-5 md:grid-cols-2">
            <Field
              label="مسئول اصلی"
              required
              error={errors.primaryOwnerId}
              hint={editing ? 'برای تغییر مسئول از گزینه «تغییر مسئول» در صفحه وظیفه استفاده کنید.' : undefined}
            >
              <EmployeePicker
                value={f.primaryOwnerId}
                onChange={(id) => set('primaryOwnerId', id)}
                filter={(e) => e.assignable}
                preferIds={[me.employee.id]}
                invalid={!!errors.primaryOwnerId}
                disabled={editing || !isManager}
              />
            </Field>
            {!editing && (
              <Field label="همکاران" hint="افراد دیگری که در انجام کار مشارکت دارند (از هر واحد).">
                <MultiEmployeePicker
                  value={f.collaboratorIds}
                  onChange={(ids) => set('collaboratorIds', ids)}
                  filter={(e) => e.id !== f.primaryOwnerId}
                />
              </Field>
            )}
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <Field label="مهلت انجام" required error={errors.deadline}>
              <DatePicker
                value={f.deadline}
                onChange={(v) => set('deadline', v)}
                withTime
                minToday
                invalid={!!errors.deadline}
              />
            </Field>
            <Field label="تاریخ شروع">
              <DatePicker value={f.startDate} onChange={(v) => set('startDate', v)} defaultTime="08:00" />
            </Field>
          </div>
          {editing && f.deadline !== task.deadline && (
            <Field label="دلیل تغییر مهلت" hint="در تاریخچه وظیفه ثبت و به مسئول اطلاع داده می‌شود.">
              <Input value={f.changeNote} onChange={(e) => set('changeNote', e.target.value)} />
            </Field>
          )}

          <Field label="اولویت" required>
            <div className="flex flex-wrap items-center gap-2">
              {PRIORITIES.map((p) => (
                <button
                  type="button"
                  key={p}
                  data-on={f.priority === p}
                  onClick={() => set('priority', p)}
                  className={cn(
                    'h-9 min-w-20 rounded-md border bg-card px-3 text-sm cursor-pointer hover:bg-muted',
                    PRIORITY_STYLE[p],
                  )}
                >
                  {TASK_PRIORITY_LABELS[p]}
                </button>
              ))}
              {me.permissions.includes('ai.use') && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => suggest.mutate()}
                  loading={suggest.isPending}
                  disabled={!f.title.trim()}
                >
                  <Lightbulb /> پیشنهاد اولویت
                </Button>
              )}
            </div>
            {suggestion && (
              <div className="mt-2 rounded-lg border bg-muted/40 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    اولویت پیشنهادی: <strong>{TASK_PRIORITY_LABELS[suggestion.priority]}</strong>
                    <span className="ms-2 text-xs text-muted-foreground">
                      ({suggestion.source === 'ai' ? 'هوش مصنوعی' : 'قواعد سامانه'})
                    </span>
                  </span>
                  {suggestion.priority !== f.priority && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => set('priority', suggestion.priority)}
                    >
                      اعمال پیشنهاد
                    </Button>
                  )}
                </div>
                <ul className="mt-1 list-disc ps-5 text-xs text-muted-foreground">
                  {suggestion.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-muted-foreground">تصمیم نهایی با شماست.</p>
              </div>
            )}
          </Field>

          <div className="grid gap-5 md:grid-cols-3">
            <Field label="دسته‌بندی">
              <Input value={f.category} onChange={(e) => set('category', e.target.value)} placeholder="مثلاً گزارش" />
            </Field>
            <Field label="برچسب‌ها" hint="با ویرگول جدا کنید">
              <Input value={f.tags} onChange={(e) => set('tags', e.target.value)} placeholder="مشتری، فصلی" />
            </Field>
            <Field label="پروژه">
              <Select
                value={f.projectId}
                onValueChange={(v) => set('projectId', v)}
                options={projects.map((p) => ({ value: p.id, label: p.name }))}
                allowClear
                clearLabel="بدون پروژه"
                placeholder="بدون پروژه"
              />
            </Field>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            <Field label="برآورد زمان (ساعت)">
              <Input
                type="number"
                min={0}
                step={0.5}
                dir="ltr"
                value={f.estimatedEffortHours}
                onChange={(e) => set('estimatedEffortHours', e.target.value)}
              />
            </Field>
            {isManager && (
              <Field label="مدیر وظیفه" hint="پیش‌فرض: شما (یا مدیر مستقیم برای وظیفه شخصی)">
                <EmployeePicker
                  value={f.managerId}
                  onChange={(id) => set('managerId', id)}
                  placeholder="خودکار"
                  clearable
                />
              </Field>
            )}
            {(me.scopes.taskManage === 'all' || me.managesDepartmentIds.length > 1) && (
              <Field label="دپارتمان" hint={owner ? `پیش‌فرض: ${owner.departmentName}` : undefined}>
                <Select
                  value={f.departmentId}
                  onValueChange={(v) => set('departmentId', v)}
                  options={departments.map((d) => ({ value: d.id, label: d.name }))}
                  allowClear
                  clearLabel="دپارتمان مسئول"
                  placeholder="دپارتمان مسئول"
                />
              </Field>
            )}
          </div>

          <div className="flex flex-wrap gap-x-8 gap-y-3">
            {isManager && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={f.requiresReview} onCheckedChange={(v) => set('requiresReview', v === true)} />
                تکمیل نیاز به تأیید مدیر دارد
              </label>
            )}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={f.confidential} onCheckedChange={(v) => set('confidential', v === true)} />
              <Lock className="size-3.5 text-muted-foreground" /> محرمانه (فقط افراد مرتبط و مدیران مجاز)
            </label>
          </div>
        </CardContent>
      </Card>

      {!editing && (
        <Card>
          <CardContent className="grid gap-4 pt-5">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox checked={f.recurring} onCheckedChange={(v) => set('recurring', v === true)} />
              <Repeat className="size-4 text-muted-foreground" /> وظیفه تکراری
            </label>
            {f.recurring && (
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="تکرار">
                  <Select
                    value={f.frequency}
                    onValueChange={(v) => set('frequency', v as RecurrenceFrequency)}
                    options={(['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'] as RecurrenceFrequency[]).map((k) => ({
                      value: k,
                      label: k === 'DAILY' ? 'هر روز کاری' : RECURRENCE_LABELS[k],
                    }))}
                  />
                </Field>
                {f.frequency !== 'DAILY' && (
                  <Field
                    label={
                      f.frequency === 'WEEKLY' ? 'هر چند هفته' : f.frequency === 'MONTHLY' ? 'هر چند ماه' : 'هر چند روز'
                    }
                  >
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      dir="ltr"
                      value={f.interval}
                      onChange={(e) => set('interval', e.target.value)}
                    />
                  </Field>
                )}
                {f.frequency === 'MONTHLY' && (
                  <Field label="روز ماه (شمسی)" hint="خالی: همان روزِ تاریخ شروع">
                    <Input
                      type="number"
                      min={1}
                      max={29}
                      dir="ltr"
                      value={f.dayOfMonth}
                      onChange={(e) => set('dayOfMonth', e.target.value)}
                    />
                  </Field>
                )}
                <Field label="پایان تکرار">
                  <DatePicker
                    value={f.endDate}
                    onChange={(v) => set('endDate', v)}
                    minToday
                    clearable
                    placeholder="بدون پایان"
                  />
                </Field>
                {f.frequency === 'WEEKLY' && (
                  <Field label="روزهای هفته" error={errors.weekdays} className="md:col-span-3">
                    <div className="flex flex-wrap gap-2">
                      {WEEK_ORDER.map((d) => (
                        <button
                          type="button"
                          key={d}
                          data-on={f.weekdays.includes(d)}
                          onClick={() =>
                            set(
                              'weekdays',
                              f.weekdays.includes(d) ? f.weekdays.filter((x) => x !== d) : [...f.weekdays, d],
                            )
                          }
                          className="h-8 rounded-md border bg-card px-3 text-sm cursor-pointer data-[on=true]:border-primary data-[on=true]:bg-accent data-[on=true]:text-accent-foreground"
                        >
                          {WEEKDAY_LABELS[d]}
                        </button>
                      ))}
                    </div>
                  </Field>
                )}
                <p className="text-xs text-muted-foreground md:col-span-3">
                  این وظیفه اولین نمونه است. نمونه‌های بعدی در هر سررسید با همین مسئول، شرح، اولویت و فاصله شروع تا
                  مهلت، خودکار ایجاد می‌شوند.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          انصراف
        </Button>
        <Button type="submit" loading={save.isPending} size="lg">
          {editing ? 'ذخیره تغییرات' : 'ایجاد وظیفه'}
        </Button>
      </div>
    </form>
  );
}
