'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { addDays, endOfMonth, startOfMonth } from 'date-fns-jalali';
import type { KpiSet, ReportResponse } from '@karban/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui/primitives';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Select,
} from '@/components/ui/overlays';
import { DatePicker } from '@/components/ui/date-picker';
import { ErrorState, PageHeader, Spinner } from '@/components/ui/layout';
import { CompletionTrendChart, Meter } from '@/components/charts/charts';
import { DelayReasonBars, KpiTiles } from '@/components/dashboard/widgets';
import { EmployeePicker } from '@/components/tasks/employee-picker';
import { errorMessage, get, queryString } from '@/lib/api';
import { useDepartments, useSession, useTeams } from '@/lib/queries';
import { faNum, formatDate } from '@/lib/utils';

type Scope = 'employee' | 'team' | 'department' | 'organization';
const PRESETS = [
  { value: '7', label: '۷ روز اخیر' },
  { value: '30', label: '۳۰ روز اخیر' },
  { value: '90', label: '۹۰ روز اخیر' },
  { value: 'month', label: 'ماه جاری (شمسی)' },
  { value: 'prev-month', label: 'ماه گذشته (شمسی)' },
  { value: 'custom', label: 'بازه دلخواه' },
];

function presetRange(preset: string): { from: string; to: string } | null {
  const now = new Date();
  if (['7', '30', '90'].includes(preset))
    return { from: addDays(now, -Number(preset)).toISOString(), to: now.toISOString() };
  if (preset === 'month') return { from: startOfMonth(now).toISOString(), to: now.toISOString() };
  if (preset === 'prev-month') {
    const prev = addDays(startOfMonth(now), -1);
    return { from: startOfMonth(prev).toISOString(), to: endOfMonth(prev).toISOString() };
  }
  return null;
}

function KpiRow({ label, k }: { label: string; k: KpiSet }) {
  return (
    <TR>
      <TD className="font-medium whitespace-nowrap">{label}</TD>
      <TD className="tabular">{faNum(k.active)}</TD>
      <TD className="tabular">{faNum(k.completed)}</TD>
      <TD>
        <Meter value={k.onTimeRate} />
      </TD>
      <TD>
        <Meter value={k.completionRate} />
      </TD>
      <TD className="tabular">{faNum(k.overdue)}</TD>
      <TD className="tabular whitespace-nowrap">{faNum(k.avgDelayDays, true)} روز</TD>
      <TD className="tabular">{faNum(k.blocked)}</TD>
    </TR>
  );
}

function ReportsInner() {
  const me = useSession();
  const params = useSearchParams();
  const departments = useDepartments().data ?? [];
  const teams = useTeams().data ?? [];
  const scopes: Array<{ value: Scope; label: string }> = [
    { value: 'employee', label: 'کارمند' },
    ...(me.scopes.report !== 'self' || me.employee.teamId ? [{ value: 'team' as Scope, label: 'تیم' }] : []),
    ...(me.scopes.report === 'department' || me.scopes.report === 'all' || me.managesDepartmentIds.length
      ? [{ value: 'department' as Scope, label: 'دپارتمان' }]
      : []),
    ...(me.scopes.report === 'all' ? [{ value: 'organization' as Scope, label: 'کل سازمان' }] : []),
  ];
  const [scope, setScope] = React.useState<Scope>(
    (params.get('scope') as Scope) ??
      (me.scopes.report === 'all' ? 'organization' : me.scopes.report === 'department' ? 'department' : 'employee'),
  );
  const [id, setId] = React.useState<string | null>(
    params.get('id') ?? (scope === 'department' ? (me.managesDepartmentIds[0] ?? me.employee.departmentId) : null),
  );
  const [preset, setPreset] = React.useState('30');
  const [custom, setCustom] = React.useState<{ from: string | null; to: string | null }>({ from: null, to: null });
  // Anchored when the preset is chosen: a range built from `new Date()` on every render
  // would change the query key each time and refetch in a loop.
  const presetValue = React.useMemo(() => presetRange(preset), [preset]);
  const range =
    preset === 'custom' ? (custom.from && custom.to ? { from: custom.from, to: custom.to } : null) : presetValue;

  const visibleTeams = teams.filter(
    (t) => me.scopes.report === 'all' || me.departmentScopeIds.includes(t.department.id) || me.employee.teamId === t.id,
  );
  const effectiveId =
    scope === 'organization' ? undefined : scope === 'employee' ? (id ?? me.employee.id) : (id ?? undefined);
  const ready = !!range && (scope === 'organization' || scope === 'employee' || !!effectiveId);
  const query = { scope, id: effectiveId, from: range?.from, to: range?.to };
  const q = useQuery({
    queryKey: ['report', query],
    queryFn: () => get<ReportResponse>('/reports/summary', query),
    enabled: ready,
  });

  return (
    <>
      <PageHeader
        title="گزارش‌ها"
        description="شاخص‌های عملیاتی برای کارمند، تیم، دپارتمان یا کل سازمان"
        actions={
          ready && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Download /> خروجی
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem asChild>
                  <a href={`/api/reports/export/summary${queryString({ ...query, format: 'xlsx' })}`}>گزارش (Excel)</a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={`/api/reports/export/summary${queryString({ ...query, format: 'csv' })}`}>گزارش (CSV)</a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
      />
      <Card className="mb-5">
        <CardContent className="grid gap-4 pt-5 md:grid-cols-4">
          <Field label="سطح گزارش">
            <Select
              value={scope}
              onValueChange={(v) => {
                setScope(v as Scope);
                setId(v === 'department' ? (me.managesDepartmentIds[0] ?? me.employee.departmentId) : null);
              }}
              options={scopes}
            />
          </Field>
          {scope === 'employee' && (
            <Field label="کارمند">
              <EmployeePicker
                value={id ?? me.employee.id}
                onChange={setId}
                filter={me.scopes.report === 'self' ? (e) => e.id === me.employee.id : undefined}
              />
            </Field>
          )}
          {scope === 'team' && (
            <Field label="تیم">
              <Select
                value={id ?? ''}
                onValueChange={setId}
                options={visibleTeams.map((t) => ({ value: t.id, label: `${t.name} — ${t.department.name}` }))}
                placeholder="انتخاب تیم"
              />
            </Field>
          )}
          {scope === 'department' && (
            <Field label="دپارتمان">
              <Select
                value={id ?? ''}
                onValueChange={setId}
                options={departments
                  .filter(
                    (d) =>
                      me.scopes.report === 'all' ||
                      me.departmentScopeIds.includes(d.id) ||
                      me.managesDepartmentIds.includes(d.id) ||
                      d.id === me.employee.departmentId,
                  )
                  .map((d) => ({ value: d.id, label: d.name }))}
              />
            </Field>
          )}
          <Field label="بازه زمانی">
            <Select value={preset} onValueChange={setPreset} options={PRESETS} />
          </Field>
          {preset === 'custom' && (
            <div className="grid grid-cols-2 gap-2 md:col-span-2">
              <Field label="از">
                <DatePicker
                  value={custom.from}
                  onChange={(v) => setCustom({ ...custom, from: v })}
                  defaultTime="00:00"
                />
              </Field>
              <Field label="تا">
                <DatePicker value={custom.to} onChange={(v) => setCustom({ ...custom, to: v })} />
              </Field>
            </div>
          )}
        </CardContent>
      </Card>
      {q.isLoading && <Spinner />}
      {q.error && <ErrorState message={errorMessage(q.error)} />}
      {q.data && (
        <div className="grid gap-5">
          <p className="text-sm text-muted-foreground">
            {q.data.scope.label} · از {formatDate(q.data.period.from)} تا {formatDate(q.data.period.to)}
          </p>
          <KpiTiles kpis={q.data.kpis} />
          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>روند تکمیل</CardTitle>
              </CardHeader>
              <CardContent>
                <CompletionTrendChart data={q.data.trend} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>دلایل تأخیر</CardTitle>
              </CardHeader>
              <CardContent>
                <DelayReasonBars items={q.data.delayReasons} />
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>
                {scope === 'organization'
                  ? 'به تفکیک دپارتمان'
                  : scope === 'employee'
                    ? 'به تفکیک اولویت'
                    : 'به تفکیک کارمند'}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-0 sm:px-0">
              <Table>
                <THead>
                  <TR>
                    <TH>عنوان</TH>
                    <TH>فعال</TH>
                    <TH>تکمیل‌شده</TH>
                    <TH>تکمیل به‌موقع</TH>
                    <TH>نرخ تکمیل سررسیدها</TH>
                    <TH>عقب‌افتاده</TH>
                    <TH>میانگین تأخیر</TH>
                    <TH>مسدود</TH>
                  </TR>
                </THead>
                <TBody>
                  <KpiRow label={`مجموع — ${q.data.scope.label}`} k={q.data.kpis} />
                  {q.data.breakdown.map((b) => (
                    <KpiRow key={b.key} label={b.label} k={b.kpis} />
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
          <p className="text-xs leading-6 text-muted-foreground">
            این گزارش داده خام عملیاتی است (مثلاً «تکمیل به‌موقع ۸۸٪») و ارزیابی عملکرد افراد محسوب نمی‌شود؛ تفسیر آن
            نیازمند بررسی انسانی و در نظر گرفتن مرخصی، وابستگی‌ها و حجم کار است.
          </p>
        </div>
      )}
    </>
  );
}

export default function ReportsPage() {
  return (
    <React.Suspense fallback={<Spinner />}>
      <ReportsInner />
    </React.Suspense>
  );
}
