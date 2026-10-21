'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import type { ManagerDashboard } from '@karban/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { Select } from '@/components/ui/overlays';
import { ErrorState, PageHeader, SectionTitle, Spinner } from '@/components/ui/layout';
import { TaskList } from '@/components/tasks/task-list';
import { SummaryCard } from '@/components/insights/summary-card';
import {
  ActivityFeed,
  KpiTiles,
  NeedsAttentionList,
  PriorityCounts,
  StatusDistribution,
  WorkloadBars,
} from '@/components/dashboard/widgets';
import { errorMessage, get } from '@/lib/api';
import { useDepartments, useSession } from '@/lib/queries';

/** Manager dashboard (PRD §34–35, §130): what needs my attention right now? */
export default function ManagerDashboardPage() {
  const me = useSession();
  const departments = useDepartments().data ?? [];
  const [departmentId, setDepartmentId] = React.useState('');
  const q = useQuery({
    queryKey: ['dashboard', 'manager', departmentId],
    queryFn: () => get<ManagerDashboard>('/dashboard/manager', { departmentId: departmentId || undefined }),
  });
  const pickable =
    me.scopes.taskView === 'all'
      ? departments
      : departments.filter((d) => me.managesDepartmentIds.includes(d.id) || d.id === me.employee.departmentId);
  const d = q.data;

  return (
    <>
      <PageHeader
        title="داشبورد مدیریتی"
        description={d ? `محدوده: ${d.scope.label}` : undefined}
        actions={
          (me.scopes.taskView === 'all' || me.managesDepartmentIds.length > 1) && (
            <div className="w-56">
              <Select
                value={departmentId}
                onValueChange={setDepartmentId}
                options={pickable.map((x) => ({ value: x.id, label: x.name }))}
                allowClear
                clearLabel="محدوده پیش‌فرض من"
                placeholder="محدوده پیش‌فرض من"
              />
            </div>
          )
        }
      />
      {q.isLoading && <Spinner />}
      {q.error && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {d && (
        <div className="grid gap-5">
          <KpiTiles kpis={d.kpis} />
          <div className="grid gap-5 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertCircle className="size-4 text-danger" /> نیازمند توجه
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {d.needsAttention.length.toLocaleString('fa-IR')}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <NeedsAttentionList items={d.needsAttention} limit={12} />
                {d.needsAttention.length > 12 && (
                  <Link
                    href="/tasks?overdue=true"
                    className="mt-3 block text-center text-sm text-primary hover:underline"
                  >
                    مشاهده همه وظایف عقب‌افتاده
                  </Link>
                )}
              </CardContent>
            </Card>
            <div className="grid content-start gap-5">
              {me.permissions.includes('ai.use') && (
                <SummaryCard
                  path="/ai/summary/manager"
                  query={{ departmentId: departmentId || undefined }}
                  title="خلاصه مدیریتی"
                />
              )}
              <Card>
                <CardHeader>
                  <CardTitle>توزیع وظایف باز</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <StatusDistribution byStatus={d.distribution.byStatus} />
                  <PriorityCounts byPriority={d.distribution.byPriority} />
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>حجم کار افراد</CardTitle>
                <Link
                  href={`/workload${departmentId ? `?departmentId=${departmentId}` : ''}`}
                  className="text-sm text-primary hover:underline"
                >
                  جزئیات
                </Link>
              </CardHeader>
              <CardContent>
                <WorkloadBars rows={d.workload} limit={10} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <SectionTitle count={d.approaching.length}>نزدیک مهلت (۳ روز آینده)</SectionTitle>
                <TaskList
                  tasks={d.approaching}
                  empty="وظیفه‌ای در سه روز آینده سررسید نمی‌شود."
                  limit={6}
                  moreHref="/tasks?dueWithinDays=7"
                />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card>
              <CardContent className="pt-5">
                <SectionTitle count={d.atRisk.length}>در معرض تأخیر</SectionTitle>
                <TaskList
                  tasks={d.atRisk}
                  empty="وظیفه پرریسکی وجود ندارد."
                  limit={5}
                  moreHref="/tasks?risk=HIGH,MEDIUM&sort=risk"
                />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <SectionTitle count={d.blocked.length}>مسدود</SectionTitle>
                <TaskList tasks={d.blocked} empty="وظیفه مسدودی وجود ندارد." limit={5} moreHref="/tasks?blocked=true" />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <SectionTitle count={d.pendingReview.length}>در انتظار تأیید شما</SectionTitle>
                <TaskList
                  tasks={d.pendingReview}
                  empty="موردی برای تأیید وجود ندارد."
                  limit={5}
                  moreHref="/tasks?pendingReview=true&status=COMPLETED"
                />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardContent className="pt-5">
                <SectionTitle>اخیراً تکمیل‌شده</SectionTitle>
                <TaskList tasks={d.recentlyCompleted} empty="در ۳۰ روز اخیر وظیفه‌ای تکمیل نشده." limit={6} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>فعالیت‌های اخیر</CardTitle>
              </CardHeader>
              <CardContent>
                <ActivityFeed items={d.recentActivity.slice(0, 10)} />
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
