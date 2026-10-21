'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Lock, Pencil, Plus } from 'lucide-react';
import type { DepartmentDto, TeamDto } from '@karban/shared';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
  Textarea,
} from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogFooter, Select } from '@/components/ui/overlays';
import { ErrorState, PageHeader, Spinner } from '@/components/ui/layout';
import { EmployeePicker, MultiEmployeePicker } from '@/components/tasks/employee-picker';
import { errorMessage, get, patch, post } from '@/lib/api';
import { qk, useDirectory, useCan } from '@/lib/queries';
import { faNum } from '@/lib/utils';

function DepartmentDialog({
  dept,
  open,
  onOpenChange,
}: {
  dept: DepartmentDto | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = React.useState({
    code: '',
    name: '',
    description: '',
    confidential: false,
    managerId: null as string | null,
    active: true,
  });
  React.useEffect(() => {
    if (open)
      setF(
        dept
          ? {
              code: dept.code,
              name: dept.name,
              description: dept.description ?? '',
              confidential: dept.confidential,
              managerId: dept.manager?.id ?? null,
              active: dept.status === 'ACTIVE',
            }
          : { code: '', name: '', description: '', confidential: false, managerId: null, active: true },
      );
  }, [open, dept]);
  const m = useMutation({
    mutationFn: () =>
      dept
        ? patch(`/departments/${dept.id}`, {
            name: f.name,
            description: f.description,
            confidential: f.confidential,
            managerId: f.managerId,
            status: f.active ? 'ACTIVE' : 'INACTIVE',
          })
        : post('/departments', {
            code: f.code,
            name: f.name,
            description: f.description || undefined,
            confidential: f.confidential,
            managerId: f.managerId ?? undefined,
          }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'departments'] });
      qc.invalidateQueries({ queryKey: qk.departments });
      toast.success('دپارتمان ذخیره شد.');
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={dept ? `ویرایش ${dept.name}` : 'دپارتمان جدید'}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          {m.error && <ErrorState message={errorMessage(m.error)} />}
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <Field label="کد" required hint="لاتین، مثل FIN">
              <Input
                dir="ltr"
                value={f.code}
                onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })}
                disabled={!!dept}
                required
              />
            </Field>
            <Field label="نام" required>
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
            </Field>
          </div>
          <Field label="توضیحات">
            <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={2} />
          </Field>
          <Field
            label="مدیر دپارتمان"
            hint="برای دسترسی کامل به داشبورد دپارتمان، نقش «مدیر دپارتمان» را نیز به این فرد بدهید."
          >
            <EmployeePicker
              value={f.managerId}
              onChange={(id) => setF({ ...f, managerId: id })}
              clearable
              placeholder="بدون مدیر"
            />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={f.confidential}
              onCheckedChange={(v) => setF({ ...f, confidential: v === true })}
              className="mt-1"
            />
            <span>
              تفکیک امنیتی بالا (محرمانه)
              <span className="block text-xs text-muted-foreground">
                وظایف جدید این واحد به‌طور پیش‌فرض محرمانه‌اند و محتوای آن‌ها برای سرویس هوش مصنوعی ارسال نمی‌شود.
              </span>
            </span>
          </label>
          {dept && (
            <div className="flex items-center gap-2">
              <Checkbox id="active" checked={f.active} onCheckedChange={(v) => setF({ ...f, active: v === true })} />
              <Label htmlFor="active" className="font-normal">
                فعال
              </Label>
            </div>
          )}
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

function TeamDialog({
  team,
  departments,
  open,
  onOpenChange,
}: {
  team: TeamDto | null;
  departments: DepartmentDto[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const directory = useDirectory().data ?? [];
  const [f, setF] = React.useState({
    name: '',
    departmentId: '',
    leadId: null as string | null,
    memberIds: [] as string[],
  });
  React.useEffect(() => {
    if (open)
      setF(
        team
          ? {
              name: team.name,
              departmentId: team.department.id,
              leadId: team.lead?.id ?? null,
              memberIds: directory.filter((e) => e.teamId === team.id).map((e) => e.id),
            }
          : { name: '', departmentId: departments[0]?.id ?? '', leadId: null, memberIds: [] },
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, team]);
  const m = useMutation({
    mutationFn: () =>
      team
        ? patch(`/teams/${team.id}`, { name: f.name, leadId: f.leadId, memberIds: f.memberIds })
        : post('/teams', {
            name: f.name,
            departmentId: f.departmentId,
            leadId: f.leadId ?? undefined,
            memberIds: f.memberIds,
          }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['admin', 'teams'] });
      qc.invalidateQueries({ queryKey: qk.directory });
      toast.success('تیم ذخیره شد.');
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={team ? `ویرایش ${team.name}` : 'تیم جدید'}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          {m.error && <ErrorState message={errorMessage(m.error)} />}
          <Field label="نام تیم" required>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          </Field>
          <Field label="دپارتمان" required>
            <Select
              value={f.departmentId}
              onValueChange={(v) => setF({ ...f, departmentId: v })}
              options={departments.map((d) => ({ value: d.id, label: d.name }))}
              disabled={!!team}
            />
          </Field>
          <Field label="سرپرست تیم" hint="سرپرست، وظایف اعضای تیم را می‌بیند و مدیریت می‌کند (با نقش «سرپرست»).">
            <EmployeePicker
              value={f.leadId}
              onChange={(id) => setF({ ...f, leadId: id })}
              filter={(e) => e.departmentId === f.departmentId}
              clearable
              placeholder="بدون سرپرست"
            />
          </Field>
          <Field label="اعضا">
            <MultiEmployeePicker
              value={f.memberIds}
              onChange={(ids) => setF({ ...f, memberIds: ids })}
              filter={(e) => e.departmentId === f.departmentId}
              placeholder="افزودن عضو"
            />
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

export default function AdminOrgPage() {
  const can = useCan();
  const depts = useQuery({
    queryKey: ['admin', 'departments'],
    queryFn: () => get<DepartmentDto[]>('/departments', { includeInactive: true }),
  });
  const teams = useQuery({ queryKey: ['admin', 'teams'], queryFn: () => get<TeamDto[]>('/teams') });
  const [dept, setDept] = React.useState<{ open: boolean; value: DepartmentDto | null }>({ open: false, value: null });
  const [team, setTeam] = React.useState<{ open: boolean; value: TeamDto | null }>({ open: false, value: null });
  return (
    <>
      <PageHeader
        title="دپارتمان‌ها و تیم‌ها"
        description="ساختار سازمانی داده‌محور است و از همین‌جا قابل تغییر است."
      />
      <div className="grid gap-5">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>دپارتمان‌ها</CardTitle>
            {can('department.manage') && (
              <Button size="sm" onClick={() => setDept({ open: true, value: null })}>
                <Plus /> دپارتمان جدید
              </Button>
            )}
          </CardHeader>
          <CardContent className="px-0 sm:px-0">
            {depts.isLoading && <Spinner />}
            {depts.data && (
              <Table>
                <THead>
                  <TR>
                    <TH>کد</TH>
                    <TH>نام</TH>
                    <TH>مدیر</TH>
                    <TH>نفرات</TH>
                    <TH>تیم‌ها</TH>
                    <TH>وضعیت</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {depts.data.map((d) => (
                    <TR key={d.id}>
                      <TD className="tabular text-xs" dir="ltr">
                        {d.code}
                      </TD>
                      <TD className="font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          {d.name}{' '}
                          {d.confidential && <Lock className="size-3 text-muted-foreground" aria-label="محرمانه" />}
                        </span>
                      </TD>
                      <TD>{d.manager?.fullName ?? <span className="text-muted-foreground">—</span>}</TD>
                      <TD className="tabular">{faNum(d.headcount)}</TD>
                      <TD className="tabular">{faNum(d.teamCount)}</TD>
                      <TD>{d.status === 'ACTIVE' ? <Badge variant="success">فعال</Badge> : <Badge>غیرفعال</Badge>}</TD>
                      <TD>
                        {can('department.manage') && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDept({ open: true, value: d })}
                            aria-label={`ویرایش ${d.name}`}
                          >
                            <Pencil />
                          </Button>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>تیم‌ها</CardTitle>
            {can('team.manage') && (
              <Button size="sm" onClick={() => setTeam({ open: true, value: null })}>
                <Plus /> تیم جدید
              </Button>
            )}
          </CardHeader>
          <CardContent className="px-0 sm:px-0">
            {teams.data && (
              <Table>
                <THead>
                  <TR>
                    <TH>تیم</TH>
                    <TH>دپارتمان</TH>
                    <TH>سرپرست</TH>
                    <TH>اعضا</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {teams.data.map((t) => (
                    <TR key={t.id}>
                      <TD className="font-medium">{t.name}</TD>
                      <TD>{t.department.name}</TD>
                      <TD>{t.lead?.fullName ?? <span className="text-muted-foreground">—</span>}</TD>
                      <TD className="tabular">{faNum(t.memberCount)}</TD>
                      <TD>
                        {can('team.manage') && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setTeam({ open: true, value: t })}
                            aria-label={`ویرایش ${t.name}`}
                          >
                            <Pencil />
                          </Button>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
      <DepartmentDialog dept={dept.value} open={dept.open} onOpenChange={(o) => setDept({ ...dept, open: o })} />
      {depts.data && (
        <TeamDialog
          team={team.value}
          departments={depts.data.filter((d) => d.status === 'ACTIVE')}
          open={team.open}
          onOpenChange={(o) => setTeam({ ...team, open: o })}
        />
      )}
    </>
  );
}
