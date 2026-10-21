'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, ShieldCheck } from 'lucide-react';
import { PERMISSION_LABELS, type Permission, type RoleDto } from '@karban/shared';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  Input,
} from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlays';
import { ErrorState, PageHeader, Spinner } from '@/components/ui/layout';
import { errorMessage, get, patch, post } from '@/lib/api';
import { faNum } from '@/lib/utils';

const GROUPS: Array<{ title: string; codes: Permission[] }> = [
  {
    title: 'وظایف',
    codes: [
      'task.create.self',
      'task.view.team',
      'task.view.department',
      'task.view.all',
      'task.manage.team',
      'task.manage.department',
      'task.manage.all',
      'project.manage',
    ],
  },
  {
    title: 'گزارش و عملکرد',
    codes: [
      'report.view.team',
      'report.view.department',
      'report.view.all',
      'performance.view',
      'performance.export',
      'ai.use',
    ],
  },
  {
    title: 'مدیریت سیستم',
    codes: [
      'user.manage',
      'department.manage',
      'team.manage',
      'role.manage',
      'settings.manage',
      'integration.manage',
      'audit.view',
    ],
  },
];

function RoleCard({ role }: { role: RoleDto }) {
  const qc = useQueryClient();
  const [perms, setPerms] = React.useState<string[]>(role.permissions);
  React.useEffect(() => setPerms(role.permissions), [role.permissions]);
  const dirty = [...perms].sort().join() !== [...role.permissions].sort().join();
  const save = useMutation({
    mutationFn: () => patch(`/roles/${role.id}`, { permissions: perms }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
      toast.success(`مجوزهای «${role.name}» ذخیره شد.`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            {role.name} {role.system && <Badge>پیش‌فرض</Badge>}
          </CardTitle>
          <CardDescription>
            {role.description} · {faNum(role.userCount)} کاربر
          </CardDescription>
        </div>
        {dirty && (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPerms(role.permissions)}>
              بازگردانی
            </Button>
            <Button size="sm" onClick={() => save.mutate()} loading={save.isPending}>
              ذخیره
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <p className="mb-2 text-xs font-medium text-muted-foreground">{g.title}</p>
            <div className="grid gap-2">
              {g.codes.map((code) => (
                <label key={code} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={perms.includes(code)}
                    onCheckedChange={(v) => setPerms(v === true ? [...perms, code] : perms.filter((p) => p !== code))}
                  />
                  {PERMISSION_LABELS[code]}
                </label>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function RolesPage() {
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['admin', 'roles'], queryFn: () => get<RoleDto[]>('/roles') });
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState({ code: '', name: '', description: '' });
  const create = useMutation({
    mutationFn: () => post('/roles', { ...f, permissions: ['task.create.self'] }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
      setOpen(false);
      setF({ code: '', name: '', description: '' });
    },
  });
  return (
    <>
      <PageHeader
        title="نقش‌ها و مجوزها"
        description="کنترل دسترسی مبتنی بر نقش؛ دامنه دید (خود، تیم، دپارتمان، سازمان) و تفکیک دپارتمان‌ها همیشه در سرور اعمال می‌شود."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> نقش جدید
          </Button>
        }
      />
      <div className="mb-5 flex gap-3 rounded-lg border border-info/30 bg-info-soft/40 p-4 text-sm leading-7">
        <ShieldCheck className="mt-1 size-4 shrink-0 text-info" />
        <p>
          اصل حداقل دسترسی: هر کاربر فقط مجوزهای لازم را داشته باشد. مدیر سیستم به‌طور پیش‌فرض به محتوای وظایف دسترسی
          ندارد. همه تغییرات مجوز در لاگ ممیزی ثبت می‌شوند.
        </p>
      </div>
      {roles.isLoading && <Spinner />}
      {roles.error && <ErrorState message={errorMessage(roles.error)} />}
      <div className="grid gap-4">
        {roles.data?.map((r) => (
          <RoleCard key={r.id} role={r} />
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="نقش جدید" size="sm">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            {create.error && <ErrorState message={errorMessage(create.error)} />}
            <Field label="کد (لاتین)" required>
              <Input
                dir="ltr"
                value={f.code}
                onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase() })}
                required
                placeholder="project_lead"
              />
            </Field>
            <Field label="نام" required>
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
            </Field>
            <Field label="توضیح">
              <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            </Field>
            <DialogFooter>
              <Button type="submit" loading={create.isPending}>
                ایجاد
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
