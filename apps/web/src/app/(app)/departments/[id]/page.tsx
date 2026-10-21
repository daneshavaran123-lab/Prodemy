'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Download, Lock } from 'lucide-react';
import type { DepartmentDashboard } from '@karban/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, Table, TBody, TD, TH, THead, TR } from '@/components/ui/primitives';
import { ErrorState, PageHeader, SectionTitle, Spinner } from '@/components/ui/layout';
import { CompletionTrendChart, Meter, OverdueTrendChart } from '@/components/charts/charts';
import { BlockerHotspots, DelayReasonBars, KpiTiles, WorkloadBars } from '@/components/dashboard/widgets';
import { TaskList } from '@/components/tasks/task-list';
import { errorMessage, get } from '@/lib/api';
import { faNum } from '@/lib/utils';

/** Department dashboard (PRD §36). */
export default function DepartmentDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({
    queryKey: ['dashboard', 'department', id],
    queryFn: () => get<DepartmentDashboard>(`/dashboard/department/${id}`),
  });
  const d = q.data;
  return (
    <>
      <PageHeader
        title={
          d ? (
            <span className="inline-flex items-center gap-2">
              {d.department.name}
              {d.department.confidential && <Lock className="size-4 text-muted-foreground" aria-label="محرمانه" />}
            </span>
          ) : (
            'داشبورد دپارتمان'
          )
        }
        description={
          d
            ? `${d.department.manager ? `مدیر: ${d.department.manager.fullName} · ` : ''}${faNum(d.department.headcount)} نفر · ${faNum(d.department.teamCount)} تیم · شاخص‌ها برای ۳۰ روز اخیر`
            : undefined
        }
        actions={
          d && (
            <Button asChild variant="outline" size="sm">
              <a href={`/api/reports/export/summary?scope=department&id=${id}&format=xlsx`}>
                <Download /> گزارش Excel
              </a>
            </Button>
          )
        }
      />
      {q.isLoading && <Spinner />}
      {q.error && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {d && (
        <div className="grid gap-5">
          <KpiTiles kpis={d.kpis} />
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>روند تکمیل هفتگی</CardTitle>
              </CardHeader>
              <CardContent>
                <CompletionTrendChart data={d.trend} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>وظایف عقب‌افتاده باز در پایان هر هفته</CardTitle>
              </CardHeader>
              <CardContent>
                <OverdueTrendChart data={d.trend} />
              </CardContent>
            </Card>
          </div>

          {d.teams.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>مقایسه تیم‌ها</CardTitle>
              </CardHeader>
              <CardContent className="px-0 sm:px-0">
                <Table>
                  <THead>
                    <TR>
                      <TH>تیم</TH>
                      <TH>نفرات</TH>
                      <TH>فعال</TH>
                      <TH>به ازای هر نفر</TH>
                      <TH>تکمیل به‌موقع</TH>
                      <TH>سهم عقب‌افتاده</TH>
                      <TH>مسدود</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {d.teams.map(({ team, kpis }) => (
                      <TR key={team.id}>
                        <TD className="font-medium">{team.name}</TD>
                        <TD className="tabular">{faNum(kpis.headcount)}</TD>
                        <TD className="tabular">{faNum(kpis.active)}</TD>
                        <TD className="tabular">{faNum(kpis.tasksPerEmployee, true)}</TD>
                        <TD>
                          <Meter value={kpis.onTimeRate} />
                        </TD>
                        <TD>
                          <Meter value={kpis.overdueRate} invert />
                        </TD>
                        <TD className="tabular">{faNum(kpis.blocked)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>حجم کار افراد</CardTitle>
              </CardHeader>
              <CardContent>
                <WorkloadBars rows={d.workload} limit={15} />
              </CardContent>
            </Card>
            <div className="grid content-start gap-5">
              <Card>
                <CardHeader>
                  <CardTitle>منشأ موانع باز</CardTitle>
                </CardHeader>
                <CardContent>
                  <BlockerHotspots items={d.blockers} />
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
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card>
              <CardContent className="pt-5">
                <SectionTitle count={d.overdue.length}>عقب‌افتاده</SectionTitle>
                <TaskList
                  tasks={d.overdue}
                  empty="وظیفه عقب‌افتاده‌ای وجود ندارد."
                  limit={6}
                  moreHref={`/tasks?departmentId=${id}&overdue=true`}
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
                  moreHref={`/tasks?departmentId=${id}&risk=HIGH,MEDIUM&sort=risk`}
                />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <SectionTitle count={d.blocked.length}>مسدود</SectionTitle>
                <TaskList
                  tasks={d.blocked}
                  empty="وظیفه مسدودی وجود ندارد."
                  limit={6}
                  moreHref={`/tasks?departmentId=${id}&blocked=true`}
                />
              </CardContent>
            </Card>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            <Link href={`/reports?scope=department&id=${id}`} className="text-primary hover:underline">
              گزارش کامل دپارتمان با انتخاب بازه زمانی
            </Link>
          </p>
        </div>
      )}
    </>
  );
}
