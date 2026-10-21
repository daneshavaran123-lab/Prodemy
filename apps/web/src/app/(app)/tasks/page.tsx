'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bookmark, ChevronLeft, ChevronRight, Download, Filter, Search, Trash2, X } from 'lucide-react';
import {
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type Paginated,
  type SavedViewDto,
  type TaskPriority,
  type TaskStatus,
  type TaskSummary,
} from '@karban/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, Field, Input } from '@/components/ui/primitives';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
} from '@/components/ui/overlays';
import { DatePicker } from '@/components/ui/date-picker';
import { EmptyState, ErrorState, PageHeader, Spinner } from '@/components/ui/layout';
import { TaskListItem } from '@/components/tasks/task-list';
import { EmployeePicker } from '@/components/tasks/employee-picker';
import { del, errorMessage, get, post, queryString } from '@/lib/api';
import { useDepartments, useProjects, useSession } from '@/lib/queries';
import { cn, faNum } from '@/lib/utils';

const FILTER_KEYS = [
  'scope',
  'status',
  'priority',
  'risk',
  'overdue',
  'blocked',
  'pendingReview',
  'delayReasonMissing',
  'departmentId',
  'ownerId',
  'managerId',
  'projectId',
  'tag',
  'q',
  'sort',
  'order',
  'deadlineFrom',
  'deadlineTo',
  'dueWithinDays',
] as const;
type Filters = Partial<Record<(typeof FILTER_KEYS)[number], string>>;

const SCOPES = [
  { value: 'visible', label: 'همه وظایف قابل مشاهده' },
  { value: 'mine', label: 'وظایف من (مسئول یا همکار)' },
  { value: 'owned', label: 'مسئول اصلی' },
  { value: 'collaborating', label: 'همکاری' },
  { value: 'managed', label: 'تحت مدیریت من' },
  { value: 'created', label: 'ایجادشده توسط من' },
];
const STATUS_OPTIONS = [
  { value: 'open', label: 'باز (همه وضعیت‌های فعال)' },
  { value: 'all', label: 'همه وضعیت‌ها' },
  { value: 'closed', label: 'بسته (تکمیل/لغو)' },
  ...(Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).map((s) => ({ value: s, label: TASK_STATUS_LABELS[s] })),
];
const SORTS = [
  { value: 'deadline', label: 'مهلت (نزدیک‌ترین)' },
  { value: 'priority', label: 'اولویت' },
  { value: 'risk', label: 'ریسک تأخیر' },
  { value: 'updatedAt', label: 'آخرین فعالیت' },
  { value: 'createdAt', label: 'تاریخ ایجاد' },
  { value: 'progress', label: 'پیشرفت' },
];
const PAGE_SIZE = 25;

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'h-9 rounded-md border px-3 text-sm whitespace-nowrap cursor-pointer',
        active ? 'border-primary bg-accent font-medium text-accent-foreground' : 'bg-card hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

function TasksPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const me = useSession();
  const qc = useQueryClient();
  const departments = useDepartments().data ?? [];
  const projects = useProjects().data ?? [];

  const filters: Filters = Object.fromEntries(
    FILTER_KEYS.map((k) => [k, params.get(k) ?? undefined]).filter(([, v]) => v),
  );
  const page = Number(params.get('page') ?? 1);
  const defaultScope = me.scopes.taskView === 'self' ? 'mine' : 'visible';
  const effective = { scope: defaultScope, status: 'open', ...filters };
  const request = { ...effective, status: effective.status === 'all' ? undefined : effective.status };

  const setFilters = (patch: Filters, keepPage = false) => {
    const next = { ...filters, ...patch };
    const qs = queryString({ ...next, page: keepPage ? String(page) : undefined });
    router.replace(`${pathname}${qs}`, { scroll: false });
  };

  const [search, setSearch] = React.useState(filters.q ?? '');
  React.useEffect(() => setSearch(params.get('q') ?? ''), [params]);

  const list = useQuery({
    queryKey: ['tasks', effective, page],
    queryFn: () => get<Paginated<TaskSummary>>('/tasks', { ...request, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });
  const views = useQuery({ queryKey: ['saved-views'], queryFn: () => get<SavedViewDto[]>('/saved-views') });
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [viewName, setViewName] = React.useState('');
  const saveView = useMutation({
    mutationFn: () => post<SavedViewDto>('/saved-views', { name: viewName, filters: effective }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['saved-views'] });
      setSaveOpen(false);
      setViewName('');
      toast.success('نما ذخیره شد.');
    },
  });

  const active = Object.keys(filters).filter((k) => !['sort', 'order'].includes(k)).length;
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const exportHref = (format: 'xlsx' | 'csv') => `/api/reports/export/tasks${queryString({ ...request, format })}`;

  return (
    <>
      <PageHeader
        title="وظایف"
        description={list.data ? `${faNum(total)} وظیفه` : undefined}
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Bookmark /> نماهای ذخیره‌شده
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64">
                {(views.data ?? []).length === 0 && <DropdownMenuLabel>هنوز نمایی ذخیره نکرده‌اید.</DropdownMenuLabel>}
                {(views.data ?? []).map((v) => (
                  <DropdownMenuItem
                    key={v.id}
                    onSelect={() => router.replace(`${pathname}${queryString(v.filters as Record<string, string>)}`)}
                    className="justify-between"
                  >
                    <span className="truncate">{v.name}</span>
                    <span
                      role="button"
                      aria-label={`حذف ${v.name}`}
                      className="rounded p-1 text-muted-foreground hover:bg-danger-soft hover:text-danger"
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        await del(`/saved-views/${v.id}`);
                        qc.invalidateQueries({ queryKey: ['saved-views'] });
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setSaveOpen(true)}>
                  <Bookmark /> ذخیره فیلترهای فعلی…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Download /> خروجی
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem asChild>
                  <a href={exportHref('xlsx')}>Excel (xlsx)</a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={exportHref('csv')}>CSV</a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <Card className="mb-4">
        <CardContent className="grid gap-3 pt-4 sm:pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <form
              className="relative min-w-52 flex-1"
              onSubmit={(e) => {
                e.preventDefault();
                setFilters({ q: search.trim() || undefined });
              }}
            >
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="جستجو در عنوان، شرح، کد، فرد یا برچسب"
                className="ps-9"
                aria-label="جستجو"
              />
            </form>
            <div className="w-full sm:w-56">
              <Select value={effective.scope} onValueChange={(v) => setFilters({ scope: v })} options={SCOPES} />
            </div>
            <div className="w-full sm:w-48">
              <Select
                value={effective.status}
                onValueChange={(v) => setFilters({ status: v || undefined })}
                options={STATUS_OPTIONS}
              />
            </div>
            <div className="w-full sm:w-36">
              <Select
                value={filters.priority ?? ''}
                onValueChange={(v) => setFilters({ priority: v || undefined })}
                options={(['URGENT', 'HIGH', 'NORMAL', 'LOW'] as TaskPriority[]).map((p) => ({
                  value: p,
                  label: `اولویت ${TASK_PRIORITY_LABELS[p]}`,
                }))}
                allowClear
                clearLabel="همه اولویت‌ها"
                placeholder="اولویت"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Toggle
              active={filters.overdue === 'true'}
              onClick={() => setFilters({ overdue: filters.overdue === 'true' ? undefined : 'true' })}
            >
              عقب‌افتاده
            </Toggle>
            <Toggle
              active={filters.blocked === 'true'}
              onClick={() => setFilters({ blocked: filters.blocked === 'true' ? undefined : 'true' })}
            >
              مسدود
            </Toggle>
            <Toggle
              active={filters.risk === 'HIGH,MEDIUM'}
              onClick={() => setFilters({ risk: filters.risk ? undefined : 'HIGH,MEDIUM' })}
            >
              در معرض تأخیر
            </Toggle>
            <Toggle
              active={filters.dueWithinDays === '7'}
              onClick={() => setFilters({ dueWithinDays: filters.dueWithinDays ? undefined : '7' })}
            >
              سررسید تا ۷ روز
            </Toggle>
            {me.scopes.taskManage !== 'self' && (
              <Toggle
                active={filters.pendingReview === 'true'}
                onClick={() =>
                  setFilters({
                    pendingReview: filters.pendingReview === 'true' ? undefined : 'true',
                    status: filters.pendingReview ? undefined : 'COMPLETED',
                  })
                }
              >
                در انتظار تأیید
              </Toggle>
            )}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="md">
                  <Filter /> فیلترهای بیشتر
                </Button>
              </PopoverTrigger>
              <PopoverContent className="grid w-[min(22rem,calc(100vw-2rem))] gap-3">
                {me.scopes.taskView !== 'self' && (
                  <Field label="دپارتمان">
                    <Select
                      value={filters.departmentId ?? ''}
                      onValueChange={(v) => setFilters({ departmentId: v || undefined })}
                      options={departments.map((d) => ({ value: d.id, label: d.name }))}
                      allowClear
                    />
                  </Field>
                )}
                <Field label="مسئول">
                  <EmployeePicker
                    value={filters.ownerId ?? null}
                    onChange={(id) => setFilters({ ownerId: id ?? undefined })}
                    placeholder="همه"
                    clearable
                  />
                </Field>
                <Field label="پروژه">
                  <Select
                    value={filters.projectId ?? ''}
                    onValueChange={(v) => setFilters({ projectId: v || undefined })}
                    options={projects.map((p) => ({ value: p.id, label: p.name }))}
                    allowClear
                  />
                </Field>
                <Field label="برچسب">
                  <Input
                    defaultValue={filters.tag}
                    onBlur={(e) => setFilters({ tag: e.target.value.trim() || undefined })}
                    placeholder="مثلاً فوری-مشتری"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="مهلت از">
                    <DatePicker
                      value={filters.deadlineFrom ?? null}
                      onChange={(v) => setFilters({ deadlineFrom: v ?? undefined })}
                      defaultTime="00:00"
                      clearable
                    />
                  </Field>
                  <Field label="تا">
                    <DatePicker
                      value={filters.deadlineTo ?? null}
                      onChange={(v) => setFilters({ deadlineTo: v ?? undefined })}
                      clearable
                    />
                  </Field>
                </div>
              </PopoverContent>
            </Popover>
            <div className="ms-auto flex items-center gap-2">
              <span className="hidden text-xs text-muted-foreground sm:inline">مرتب‌سازی:</span>
              <div className="w-44">
                <Select
                  value={filters.sort ?? 'deadline'}
                  onValueChange={(v) => setFilters({ sort: v })}
                  options={SORTS}
                />
              </div>
              {active > 0 && (
                <Button variant="ghost" size="sm" onClick={() => router.replace(pathname)}>
                  <X /> حذف فیلترها
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {list.error && <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />}
      {list.isLoading && <Spinner />}
      {list.data && list.data.items.length === 0 && (
        <EmptyState
          title="وظیفه‌ای با این فیلترها یافت نشد."
          description="فیلترها را تغییر دهید یا وظیفه جدیدی ایجاد کنید."
        />
      )}
      {list.data && list.data.items.length > 0 && (
        <Card className={cn(list.isFetching && 'opacity-70 transition-opacity')}>
          <CardContent className="pt-2 sm:pt-2">
            <ul className="divide-y divide-border/60">
              {list.data.items.map((t) => (
                <TaskListItem key={t.id} task={t} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <Button
            variant="outline"
            size="icon-sm"
            disabled={page <= 1}
            onClick={() => router.replace(`${pathname}${queryString({ ...filters, page: String(page - 1) })}`)}
            aria-label="صفحه قبل"
          >
            <ChevronRight />
          </Button>
          <span className="tabular text-muted-foreground">
            صفحه {faNum(page)} از {faNum(pages)}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={page >= pages}
            onClick={() => router.replace(`${pathname}${queryString({ ...filters, page: String(page + 1) })}`)}
            aria-label="صفحه بعد"
          >
            <ChevronLeft />
          </Button>
        </div>
      )}

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent title="ذخیره نما" description="فیلترها و مرتب‌سازی فعلی با این نام ذخیره می‌شوند." size="sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveView.mutate();
            }}
          >
            {saveView.error && <ErrorState message={errorMessage(saveView.error)} />}
            <Field label="نام نما">
              <Input
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                required
                autoFocus
                placeholder="مثلاً عقب‌افتاده‌های تیم فروش"
              />
            </Field>
            <DialogFooter>
              <Button type="submit" loading={saveView.isPending} disabled={!viewName.trim()}>
                ذخیره
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function TasksPage() {
  return (
    <React.Suspense fallback={<Spinner />}>
      <TasksPageInner />
    </React.Suspense>
  );
}
