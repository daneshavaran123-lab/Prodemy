'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Copy, KeyRound, MoreHorizontal, Pencil, Search, UserCheck, UserPlus, UserX } from 'lucide-react';
import {
  EMPLOYMENT_STATUS_LABELS,
  USER_STATUS_LABELS,
  type EmploymentStatus,
  type Paginated,
  type RoleDto,
  type UserAdminDto,
  type UserStatus,
} from '@karban/shared';
import { Button } from '@/components/ui/button';
import {
  Avatar,
  Badge,
  Card,
  CardContent,
  Checkbox,
  Field,
  Input,
  Label,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui/primitives';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
} from '@/components/ui/overlays';
import { EmptyState, ErrorState, PageHeader, Spinner } from '@/components/ui/layout';
import { EmployeePicker } from '@/components/tasks/employee-picker';
import { errorMessage, get, patch, post } from '@/lib/api';
import { qk, useDepartments, useTeams } from '@/lib/queries';
import { faNum, timeAgo } from '@/lib/utils';

const STATUS_VARIANT: Record<UserStatus, 'warning' | 'success' | 'neutral'> = {
  PENDING: 'warning',
  ACTIVE: 'success',
  DISABLED: 'neutral',
};

interface UserForm {
  username: string;
  fullName: string;
  email: string;
  employeeCode: string;
  jobTitle: string;
  phone: string;
  departmentId: string;
  teamId: string;
  managerId: string | null;
  roleId: string;
  employmentStatus: EmploymentStatus;
  password: string;
}

function UserDialog({
  user,
  roles,
  open,
  onOpenChange,
}: {
  user: UserAdminDto | null;
  roles: RoleDto[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const departments = useDepartments().data ?? [];
  const blank: UserForm = {
    username: '',
    fullName: '',
    email: '',
    employeeCode: '',
    jobTitle: '',
    phone: '',
    departmentId: '',
    teamId: '',
    managerId: null,
    roleId: roles.find((r) => r.code === 'employee')?.id ?? '',
    employmentStatus: 'ACTIVE',
    password: '',
  };
  const [f, setF] = React.useState<UserForm>(blank);
  const [temp, setTemp] = React.useState<string | null>(null);
  const teams = useTeams(f.departmentId || undefined).data ?? [];
  React.useEffect(() => {
    if (!open) return;
    setTemp(null);
    setF(
      user
        ? {
            username: user.username,
            fullName: user.employee.fullName,
            email: user.email ?? '',
            employeeCode: user.employee.employeeCode,
            jobTitle: user.employee.jobTitle ?? '',
            phone: user.employee.phone ?? '',
            departmentId: user.employee.department.id,
            teamId: user.employee.team?.id ?? '',
            managerId: user.employee.manager?.id ?? null,
            roleId: user.role.id,
            employmentStatus: user.employee.employmentStatus,
            password: '',
          }
        : blank,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user]);
  const set = <K extends keyof UserForm>(k: K, v: UserForm[K]) => setF((s) => ({ ...s, [k]: v }));
  const m = useMutation({
    mutationFn: () =>
      user
        ? patch(`/users/${user.id}`, {
            fullName: f.fullName,
            email: f.email || null,
            employeeCode: f.employeeCode || undefined,
            jobTitle: f.jobTitle || undefined,
            phone: f.phone || undefined,
            departmentId: f.departmentId,
            teamId: f.teamId || null,
            managerId: f.managerId,
            roleId: f.roleId,
            employmentStatus: f.employmentStatus,
          })
        : post<{ temporaryPassword?: string }>('/users', {
            username: f.username,
            fullName: f.fullName,
            email: f.email || undefined,
            employeeCode: f.employeeCode || undefined,
            jobTitle: f.jobTitle || undefined,
            phone: f.phone || undefined,
            departmentId: f.departmentId,
            teamId: f.teamId || undefined,
            managerId: f.managerId ?? undefined,
            roleId: f.roleId,
            password: f.password || undefined,
          }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      qc.invalidateQueries({ queryKey: qk.directory });
      const tp = (res as { temporaryPassword?: string } | undefined)?.temporaryPassword;
      if (tp) setTemp(tp);
      else {
        toast.success(user ? 'اطلاعات کاربر ذخیره شد.' : 'کاربر ایجاد شد.');
        onOpenChange(false);
      }
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={user ? `ویرایش ${user.employee.fullName}` : 'کاربر جدید'} size="lg">
        {temp ? (
          <TempPassword password={temp} onDone={() => onOpenChange(false)} />
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              m.mutate();
            }}
            className="grid gap-4"
          >
            {m.error && <ErrorState message={errorMessage(m.error)} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="نام و نام خانوادگی" required>
                <Input value={f.fullName} onChange={(e) => set('fullName', e.target.value)} required />
              </Field>
              <Field label="نام کاربری" required>
                <Input
                  dir="ltr"
                  value={f.username}
                  onChange={(e) => set('username', e.target.value)}
                  required
                  disabled={!!user}
                />
              </Field>
              <Field label="ایمیل">
                <Input dir="ltr" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
              </Field>
              <Field label="کد پرسنلی" hint={user ? undefined : 'خالی: تولید خودکار'}>
                <Input dir="ltr" value={f.employeeCode} onChange={(e) => set('employeeCode', e.target.value)} />
              </Field>
              <Field label="سمت">
                <Input value={f.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} />
              </Field>
              <Field label="تلفن">
                <Input dir="ltr" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
              </Field>
              <Field
                label="دپارتمان"
                required
                hint={
                  user && f.departmentId !== user.employee.department.id
                    ? 'وظایف قبلی در دپارتمان قبلی باقی می‌مانند.'
                    : undefined
                }
              >
                <Select
                  value={f.departmentId}
                  onValueChange={(v) => setF((s) => ({ ...s, departmentId: v, teamId: '' }))}
                  options={departments.map((d) => ({ value: d.id, label: d.name }))}
                />
              </Field>
              <Field label="تیم">
                <Select
                  value={f.teamId}
                  onValueChange={(v) => set('teamId', v)}
                  options={teams.map((t) => ({ value: t.id, label: t.name }))}
                  allowClear
                  clearLabel="بدون تیم"
                  placeholder="بدون تیم"
                />
              </Field>
              <Field label="مدیر مستقیم">
                <EmployeePicker
                  value={f.managerId}
                  onChange={(id) => set('managerId', id)}
                  placeholder="بدون مدیر"
                  clearable
                />
              </Field>
              <Field label="نقش" required>
                <Select
                  value={f.roleId}
                  onValueChange={(v) => set('roleId', v)}
                  options={roles.map((r) => ({ value: r.id, label: r.name }))}
                />
              </Field>
              {user ? (
                <Field label="وضعیت استخدام">
                  <Select
                    value={f.employmentStatus}
                    onValueChange={(v) => set('employmentStatus', v as EmploymentStatus)}
                    options={(Object.keys(EMPLOYMENT_STATUS_LABELS) as EmploymentStatus[]).map((k) => ({
                      value: k,
                      label: EMPLOYMENT_STATUS_LABELS[k],
                    }))}
                  />
                </Field>
              ) : (
                <Field label="رمز عبور اولیه" hint="خالی: رمز موقت تولید و یک‌بار نمایش داده می‌شود">
                  <Input
                    dir="ltr"
                    type="password"
                    value={f.password}
                    onChange={(e) => set('password', e.target.value)}
                    autoComplete="new-password"
                  />
                </Field>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                انصراف
              </Button>
              <Button
                type="submit"
                loading={m.isPending}
                disabled={!f.fullName || !f.departmentId || !f.roleId || (!user && !f.username)}
              >
                {user ? 'ذخیره' : 'ایجاد کاربر'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TempPassword({ password, onDone }: { password: string; onDone: () => void }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="grid gap-4 text-sm">
      <p>
        رمز عبور موقت فقط همین یک بار نمایش داده می‌شود. آن را به‌صورت امن به کاربر بدهید؛ در اولین ورود باید تغییرش
        دهد.
      </p>
      <div className="flex items-center gap-2 rounded-lg border bg-muted p-3">
        <code dir="ltr" className="flex-1 text-base font-semibold">
          {password}
        </code>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(password).catch(() => undefined);
            setCopied(true);
          }}
        >
          {copied ? <Check /> : <Copy />} کپی
        </Button>
      </div>
      <DialogFooter>
        <Button onClick={onDone}>متوجه شدم</Button>
      </DialogFooter>
    </div>
  );
}

function UsersInner() {
  const qc = useQueryClient();
  const params = useSearchParams();
  const departments = useDepartments().data ?? [];
  const [status, setStatus] = React.useState(params.get('status') ?? '');
  const [departmentId, setDepartmentId] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [q, setQ] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [editing, setEditing] = React.useState<UserAdminDto | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [disableTarget, setDisableTarget] = React.useState<UserAdminDto | null>(null);
  const [terminated, setTerminated] = React.useState(false);
  const [temp, setTemp] = React.useState<string | null>(null);
  const roles = useQuery({ queryKey: ['admin', 'roles'], queryFn: () => get<RoleDto[]>('/roles') });
  const list = useQuery({
    queryKey: ['admin', 'users', status, departmentId, q, page],
    queryFn: () =>
      get<Paginated<UserAdminDto>>('/users', {
        status: status || undefined,
        departmentId: departmentId || undefined,
        q: q || undefined,
        page,
        pageSize: 50,
      }),
  });
  const action = useMutation({
    mutationFn: ({
      user,
      op,
      body,
    }: {
      user: UserAdminDto;
      op: 'approve' | 'enable' | 'disable' | 'reset-password';
      body?: object;
    }) => post<{ temporaryPassword?: string }>(`/users/${user.id}/${op}`, body ?? {}),
    onSuccess: (res, v) => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      if (res?.temporaryPassword) setTemp(res.temporaryPassword);
      else
        toast.success(
          { approve: 'حساب تأیید شد.', enable: 'حساب فعال شد.', disable: 'حساب غیرفعال شد.', 'reset-password': '' }[
            v.op
          ],
        );
      setDisableTarget(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pending = (list.data?.items ?? []).filter((u) => u.status === 'PENDING').length;

  return (
    <>
      <PageHeader
        title="کاربران"
        description={list.data ? `${faNum(list.data.total)} کاربر` : undefined}
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <UserPlus /> کاربر جدید
          </Button>
        }
      />
      <Card className="mb-4">
        <CardContent className="flex flex-wrap gap-2 pt-4 sm:pt-4">
          <form
            className="relative min-w-52 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              setQ(search.trim());
              setPage(1);
            }}
          >
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="نام، نام کاربری، ایمیل یا کد پرسنلی"
              className="ps-9"
            />
          </form>
          <div className="w-44">
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
              options={(Object.keys(USER_STATUS_LABELS) as UserStatus[]).map((s) => ({
                value: s,
                label: USER_STATUS_LABELS[s],
              }))}
              allowClear
              clearLabel="همه وضعیت‌ها"
              placeholder="همه وضعیت‌ها"
            />
          </div>
          <div className="w-52">
            <Select
              value={departmentId}
              onValueChange={setDepartmentId}
              options={departments.map((d) => ({ value: d.id, label: d.name }))}
              allowClear
              clearLabel="همه دپارتمان‌ها"
              placeholder="همه دپارتمان‌ها"
            />
          </div>
        </CardContent>
      </Card>
      {status !== 'PENDING' && pending > 0 && (
        <button
          className="mb-4 w-full rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-start text-sm text-warning cursor-pointer"
          onClick={() => setStatus('PENDING')}
        >
          {faNum(pending)} درخواست ثبت‌نام در انتظار تأیید است.
        </button>
      )}
      {list.isLoading && <Spinner />}
      {list.error && <ErrorState message={errorMessage(list.error)} />}
      {list.data?.items.length === 0 && <EmptyState title="کاربری یافت نشد." />}
      {!!list.data?.items.length && (
        <Card>
          <CardContent className="px-0 sm:px-0">
            <Table>
              <THead>
                <TR>
                  <TH>کاربر</TH>
                  <TH>دپارتمان / تیم</TH>
                  <TH>مدیر</TH>
                  <TH>نقش</TH>
                  <TH>وضعیت</TH>
                  <TH>وظایف باز</TH>
                  <TH>آخرین ورود</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {list.data.items.map((u) => (
                  <TR key={u.id}>
                    <TD>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={u.employee.fullName} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{u.employee.fullName}</p>
                          <p className="truncate text-xs text-muted-foreground" dir="ltr">
                            {u.username} · {u.employee.employeeCode}
                          </p>
                        </div>
                      </div>
                    </TD>
                    <TD className="whitespace-nowrap">
                      {u.employee.department.name}
                      {u.employee.team && (
                        <span className="block text-xs text-muted-foreground">{u.employee.team.name}</span>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{u.employee.manager?.fullName ?? '—'}</TD>
                    <TD className="whitespace-nowrap">{u.role.name}</TD>
                    <TD>
                      <Badge variant={STATUS_VARIANT[u.status]}>{USER_STATUS_LABELS[u.status]}</Badge>
                      {u.employee.employmentStatus !== 'ACTIVE' && (
                        <span className="ms-1 text-xs text-muted-foreground">
                          {EMPLOYMENT_STATUS_LABELS[u.employee.employmentStatus]}
                        </span>
                      )}
                    </TD>
                    <TD className="tabular">{faNum(u.openTaskCount)}</TD>
                    <TD className="whitespace-nowrap text-xs text-muted-foreground">
                      {u.lastLoginAt ? timeAgo(u.lastLoginAt) : '—'}
                    </TD>
                    <TD>
                      <div className="flex justify-end gap-1">
                        {u.status === 'PENDING' && (
                          <Button size="sm" onClick={() => action.mutate({ user: u, op: 'approve' })}>
                            <UserCheck /> تأیید
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label="عملیات">
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              onSelect={() => {
                                setEditing(u);
                                setDialogOpen(true);
                              }}
                            >
                              <Pencil /> ویرایش
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => action.mutate({ user: u, op: 'reset-password' })}>
                              <KeyRound /> بازنشانی رمز عبور
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {u.status === 'DISABLED' ? (
                              <DropdownMenuItem onSelect={() => action.mutate({ user: u, op: 'enable' })}>
                                <UserCheck /> فعال‌سازی مجدد
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem destructive onSelect={() => setDisableTarget(u)}>
                                <UserX /> غیرفعال‌سازی
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {list.data && list.data.total > 50 && (
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            قبلی
          </Button>
          <Button variant="outline" size="sm" disabled={page * 50 >= list.data.total} onClick={() => setPage(page + 1)}>
            بعدی
          </Button>
        </div>
      )}

      {roles.data && <UserDialog user={editing} roles={roles.data} open={dialogOpen} onOpenChange={setDialogOpen} />}

      <Dialog open={!!disableTarget} onOpenChange={(o) => !o && setDisableTarget(null)}>
        <DialogContent title="غیرفعال‌سازی حساب" description={disableTarget?.employee.fullName}>
          <div className="grid gap-4 text-sm leading-7">
            <p>
              کاربر از همه نشست‌ها خارج می‌شود و دیگر نمی‌تواند وارد شود. تاریخچه حفظ می‌شود و مدیران وظایف باز او (
              {faNum(disableTarget?.openTaskCount ?? 0)} وظیفه) برای تخصیص مجدد مطلع می‌شوند.
            </p>
            <div className="flex items-center gap-2">
              <Checkbox id="terminated" checked={terminated} onCheckedChange={(v) => setTerminated(v === true)} />
              <Label htmlFor="terminated" className="font-normal">
                همکاری این فرد با سازمان پایان یافته است
              </Label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDisableTarget(null)}>
                انصراف
              </Button>
              <Button
                variant="destructive"
                loading={action.isPending}
                onClick={() =>
                  disableTarget && action.mutate({ user: disableTarget, op: 'disable', body: { terminated } })
                }
              >
                غیرفعال‌سازی
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!temp} onOpenChange={(o) => !o && setTemp(null)}>
        <DialogContent title="رمز عبور موقت">
          {temp && <TempPassword password={temp} onDone={() => setTemp(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function AdminUsersPage() {
  return (
    <React.Suspense fallback={<Spinner />}>
      <UsersInner />
    </React.Suspense>
  );
}
