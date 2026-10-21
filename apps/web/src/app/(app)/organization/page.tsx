'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpDown, Lock } from 'lucide-react';
import type { DepartmentComparisonRow, KpiSet, OrganizationDashboard } from '@karban/shared';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui/primitives';
import { ErrorState, PageHeader, SectionTitle, Spinner } from '@/components/ui/layout';
import { CompletionTrendChart, HBarList, Meter, OverdueTrendChart } from '@/components/charts/charts';
import { BlockerHotspots, DelayReasonBars, KpiTiles, WorkloadBars } from '@/components/dashboard/widgets';
import { SummaryCard } from '@/components/insights/summary-card';
import { TaskList } from '@/components/tasks/task-list';
import { errorMessage, get } from '@/lib/api';
import { useSession } from '@/lib/queries';
import { cn, faNum } from '@/lib/utils';

type SortKey = 'name' | 'onTimeRate' | 'overdueRate' | 'avgDelayDays' | 'tasksPerEmployee' | 'blockedRate' | 'riskRate';

const COLUMNS: Array<{ key: SortKey; label: string; hint: string }> = [
  { key: 'tasksPerEmployee', label: 'وظیفه فعال/نفر', hint: 'وظایف فعال تقسیم بر تعداد نفرات' },
  { key: 'onTimeRate', label: 'تکمیل به‌موقع', hint: 'سهم وظایف تکمیل‌شده ۳۰ روز اخیر که در مهلت انجام شدند' },
  { key: 'overdueRate', label: 'سهم عقب‌افتاده', hint: 'وظایف عقب‌افتاده تقسیم بر وظایف فعال' },
  { key: 'avgDelayDays', label: 'میانگین تأخیر', hint: 'میانگین روز تأخیر وظایف دیرکرددار' },
  { key: 'blockedRate', label: 'سهم مسدود', hint: 'وظایف مسدود تقسیم بر وظایف فعال' },
  { key: 'riskRate', label: 'سهم پرریسک', hint: 'وظایف با ریسک بالا تقسیم بر وظایف فعال' },
];

function value(row: DepartmentComparisonRow, key: SortKey): number {
  if (key === 'name') return 0;
  return (row.kpis[key as keyof KpiSet] as number | null) ?? -1;
}

/** CEO dashboard (PRD §37–38): relative KPIs, because departments differ greatly in size. */
export default function OrganizationPage() {
  const me = useSession();
  const [period, setPeriod] = React.useState<'week' | 'month'>('week');
  const [sort, setSort] = React.useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'overdueRate', dir: -1 });
  const q = useQuery({
    queryKey: ['dashboard', 'organization'],
    queryFn: () => get<OrganizationDashboard>('/dashboard/organization'),
  });
  const d = q.data;
  const rows = d
    ? [...d.departments].sort((a, b) =>
        sort.key === 'name'
          ? a.department.name.localeCompare(b.department.name, 'fa') * sort.dir
          : (value(a, sort.key) - value(b, sort.key)) * sort.dir,
      )
    : [];

  return (
    <>
      <PageHeader title="داشبورد سازمان" description="نمای کلی هر هشت دپارتمان — شاخص‌ها برای ۳۰ روز اخیر" />
      {q.isLoading && <Spinner />}
      {q.error && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {d && (
        <div className="grid gap-5">
          <KpiTiles kpis={d.kpis} />

          <div className="grid gap-5 xl:grid-cols-3">
            {me.permissions.includes('ai.use') && (
              <div className="grid content-start gap-2">
                <div className="flex gap-1 self-start rounded-md bg-muted p-0.5 text-xs">
                  {(
                    [
                      ['week', 'هفتگی'],
                      ['month', 'ماهانه'],
                    ] as const
                  ).map(([v, l]) => (
                    <button
                      key={v}
                      onClick={() => setPeriod(v)}
                      className={cn('rounded px-3 py-1 cursor-pointer', period === v && 'bg-card shadow-sm')}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <SummaryCard path="/ai/summary/executive" query={{ period }} title="خلاصه مدیریتی سازمان" />
              </div>
            )}
            <Card className={me.permissions.includes('ai.use') ? 'xl:col-span-2' : 'xl:col-span-3'}>
              <CardHeader>
                <CardTitle>مقایسه دپارتمان‌ها</CardTitle>
                <CardDescription>شاخص‌های نسبی؛ برای مرتب‌سازی روی عنوان ستون بزنید.</CardDescription>
              </CardHeader>
              <CardContent className="px-0 sm:px-0">
                <Table>
                  <THead>
                    <TR>
                      <TH>
                        <button
                          className="inline-flex items-center gap-1 cursor-pointer"
                          onClick={() => setSort({ key: 'name', dir: sort.key === 'name' ? (-sort.dir as 1 | -1) : 1 })}
                        >
                          دپارتمان <ArrowUpDown className="size-3" />
                        </button>
                      </TH>
                      <TH>نفرات</TH>
                      <TH>فعال</TH>
                      {COLUMNS.map((c) => (
                        <TH key={c.key} title={c.hint}>
                          <button
                            className={cn(
                              'inline-flex items-center gap-1 cursor-pointer',
                              sort.key === c.key && 'text-foreground',
                            )}
                            onClick={() =>
                              setSort({ key: c.key, dir: sort.key === c.key ? (-sort.dir as 1 | -1) : -1 })
                            }
                          >
                            {c.label} <ArrowUpDown className="size-3" />
                          </button>
                        </TH>
                      ))}
                    </TR>
                  </THead>
                  <TBody>
                    {rows.map((r) => (
                      <TR key={r.department.id}>
                        <TD>
                          <Link
                            href={`/departments/${r.department.id}`}
                            className="inline-flex items-center gap-1.5 font-medium whitespace-nowrap hover:text-primary"
                          >
                            {r.department.name}
                            {r.department.confidential && <Lock className="size-3 text-muted-foreground" />}
                          </Link>
                        </TD>
                        <TD className="tabular">{faNum(r.kpis.headcount)}</TD>
                        <TD className="tabular">{faNum(r.kpis.active)}</TD>
                        <TD className="tabular">{faNum(r.kpis.tasksPerEmployee, true)}</TD>
                        <TD>
                          <Meter value={r.kpis.onTimeRate} />
                        </TD>
                        <TD>
                          <Meter value={r.kpis.overdueRate} invert />
                        </TD>
                        <TD className="tabular whitespace-nowrap">{faNum(r.kpis.avgDelayDays, true)} روز</TD>
                        <TD>
                          <Meter value={r.kpis.blockedRate} invert />
                        </TD>
                        <TD>
                          <Meter value={r.kpis.riskRate} invert />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>روند تکمیل هفتگی سازمان</CardTitle>
              </CardHeader>
              <CardContent>
                <CompletionTrendChart data={d.trend} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>وظایف عقب‌افتاده باز</CardTitle>
              </CardHeader>
              <CardContent>
                <OverdueTrendChart data={d.trend} />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardContent className="pt-5">
                <SectionTitle count={d.critical.length}>وظایف بحرانی</SectionTitle>
                <TaskList
                  tasks={d.critical}
                  empty="وظیفه بحرانی وجود ندارد."
                  limit={8}
                  moreHref="/tasks?priority=URGENT"
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>گلوگاه‌ها</CardTitle>
                <CardDescription>واحدها و عوامل ایجادکننده بیشترین موانع باز</CardDescription>
              </CardHeader>
              <CardContent>
                <BlockerHotspots items={d.bottlenecks} />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>میانگین بار کاری هر نفر</CardTitle>
              </CardHeader>
              <CardContent>
                <HBarList
                  rows={d.workload.departmentLoad.map((x) => ({
                    key: x.department.id,
                    label: x.department.name,
                    value: x.avgLoad,
                  }))}
                  format={(v) => faNum(v, true)}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>افراد با بار کاری بالا</CardTitle>
              </CardHeader>
              <CardContent>
                <WorkloadBars rows={d.workload.overloaded} limit={8} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>دلایل تأخیر (۳۰ روز)</CardTitle>
              </CardHeader>
              <CardContent>
                <DelayReasonBars items={d.delayReasons} />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardContent className="pt-5">
                <SectionTitle count={d.overdue.length}>بیشترین تأخیر</SectionTitle>
                <TaskList
                  tasks={d.overdue}
                  empty="وظیفه عقب‌افتاده‌ای وجود ندارد."
                  limit={6}
                  moreHref="/tasks?overdue=true"
                />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <SectionTitle count={d.atRisk.length}>در معرض تأخیر</SectionTitle>
                <TaskList
                  tasks={d.atRisk}
                  empty="وظیفه پرریسکی وجود ندارد."
                  limit={6}
                  moreHref="/tasks?risk=HIGH&sort=risk"
                />
              </CardContent>
            </Card>
          </div>
          {d.workload.underutilized.length > 0 && (
            <p className="text-center text-xs text-muted-foreground">
              {faNum(d.workload.underutilized.length)} نفر ظرفیت آزاد دارند —{' '}
              <Link href="/workload" className="text-primary hover:underline">
                بررسی توزیع کار
              </Link>
            </p>
          )}
        </div>
      )}
    </>
  );
}
