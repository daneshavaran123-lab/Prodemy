'use client';

import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Database, Download, Info } from 'lucide-react';
import { addMonths, format } from 'date-fns-jalali';
import { faIR } from 'date-fns-jalali/locale';
import { toPersianDigits, type PerformanceMetricRow } from '@karban/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, Field, Table, TBody, TD, TH, THead, TR } from '@/components/ui/primitives';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Select,
} from '@/components/ui/overlays';
import { ErrorState, PageHeader, Spinner } from '@/components/ui/layout';
import { errorMessage, get, post, queryString } from '@/lib/api';
import { useDepartments, useSession } from '@/lib/queries';
import { faNum, faPercent } from '@/lib/utils';

function months() {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = addMonths(now, -i);
    return { value: format(d, 'yyyy-MM'), label: toPersianDigits(format(d, 'MMMM yyyy', { locale: faIR })) };
  });
}

/** HR view (PRD §60–62, §108): raw operational metrics only — never an evaluation. */
export default function PerformancePage() {
  const me = useSession();
  const departments = useDepartments().data ?? [];
  const options = React.useMemo(months, []);
  const [period, setPeriod] = React.useState(options[0].value);
  const [departmentId, setDepartmentId] = React.useState('');
  const query = { period, departmentId: departmentId || undefined };
  const q = useQuery({
    queryKey: ['performance', query],
    queryFn: () => get<PerformanceMetricRow[]>('/performance/metrics', query),
  });
  const snapshot = useMutation({
    mutationFn: () => post<{ period: string; records: number }>(`/performance/snapshots${queryString({ period })}`),
    onSuccess: (r) => toast.success(`${faNum(r.records)} رکورد برای دوره ${toPersianDigits(r.period)} ذخیره شد.`),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const canExport = me.permissions.includes('performance.export');
  return (
    <>
      <PageHeader
        title="داده‌های عملکردی"
        description="داده خام عملیاتی برای استفاده در فرایند ارزیابی عملکرد"
        actions={
          canExport && (
            <>
              <Button variant="outline" size="sm" onClick={() => snapshot.mutate()} loading={snapshot.isPending}>
                <Database /> ثبت اسنپ‌شات دوره
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Download /> خروجی
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem asChild>
                    <a href={`/api/performance/export${queryString({ ...query, format: 'xlsx' })}`}>Excel (xlsx)</a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={`/api/performance/export${queryString({ ...query, format: 'csv' })}`}>CSV</a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )
        }
      />
      <div className="mb-5 flex gap-3 rounded-lg border border-info/30 bg-info-soft/40 p-4 text-sm leading-7">
        <Info className="mt-1 size-4 shrink-0 text-info" />
        <p>
          این جدول فقط واقعیت‌های عملیاتی را نشان می‌دهد (مثلاً «تکمیل به‌موقع ۸۸٪»)، نه ارزیابی (مثلاً «عملکرد خوب»).
          هرگونه ارزیابی باید با بررسی انسانی و با در نظر گرفتن مرخصی، وابستگی به واحدهای دیگر و حجم کار انجام شود.
          محتوای وظایف در این بخش نمایش داده نمی‌شود.
        </p>
      </div>
      <Card className="mb-5">
        <CardContent className="grid gap-4 pt-5 sm:grid-cols-3">
          <Field label="دوره (ماه شمسی)">
            <Select value={period} onValueChange={setPeriod} options={options} />
          </Field>
          <Field label="دپارتمان">
            <Select
              value={departmentId}
              onValueChange={setDepartmentId}
              options={departments.map((d) => ({ value: d.id, label: d.name }))}
              allowClear
              clearLabel="همه دپارتمان‌ها"
              placeholder="همه دپارتمان‌ها"
            />
          </Field>
        </CardContent>
      </Card>
      {q.isLoading && <Spinner />}
      {q.error && <ErrorState message={errorMessage(q.error)} />}
      {q.data && (
        <Card>
          <CardContent className="px-0 sm:px-0">
            <Table>
              <THead>
                <TR>
                  <TH>کد</TH>
                  <TH>نام</TH>
                  <TH>دپارتمان</TH>
                  <TH>وظایف دوره</TH>
                  <TH>تکمیل‌شده</TH>
                  <TH>به‌موقع</TH>
                  <TH>عقب‌افتاده</TH>
                  <TH>نرخ تکمیل</TH>
                  <TH>نرخ به‌موقع</TH>
                  <TH>میانگین تأخیر</TH>
                  <TH>فعال</TH>
                  <TH>مسدود</TH>
                  <TH>نرخ به‌روزرسانی</TH>
                </TR>
              </THead>
              <TBody>
                {q.data.map((r) => (
                  <TR key={r.employee.id}>
                    <TD className="tabular text-xs text-muted-foreground">{r.employee.employeeCode}</TD>
                    <TD className="whitespace-nowrap font-medium">{r.employee.fullName}</TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{r.department.name}</TD>
                    <TD className="tabular">{faNum(r.totalTasks)}</TD>
                    <TD className="tabular">{faNum(r.completedTasks)}</TD>
                    <TD className="tabular">{faNum(r.completedOnTime)}</TD>
                    <TD className="tabular">{faNum(r.overdueTasks)}</TD>
                    <TD className="tabular">{faPercent(r.completionRate)}</TD>
                    <TD className="tabular">{faPercent(r.onTimeRate)}</TD>
                    <TD className="tabular whitespace-nowrap">{faNum(r.avgDelayDays, true)} روز</TD>
                    <TD className="tabular">{faNum(r.activeWorkload)}</TD>
                    <TD className="tabular">{faNum(r.blockedTasks)}</TD>
                    <TD className="tabular">{faPercent(r.updateRate)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
