'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, Ban, CalendarClock, CheckCircle2, ClipboardList, FileWarning, Sun } from 'lucide-react';
import type { EmployeeDashboard } from '@karban/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { ErrorState, PageHeader, SectionTitle, Spinner, StatTile } from '@/components/ui/layout';
import { TaskList } from '@/components/tasks/task-list';
import { SummaryCard } from '@/components/insights/summary-card';
import { errorMessage, get } from '@/lib/api';
import { useSession } from '@/lib/queries';
import { faNum, formatDate, formatWeekday } from '@/lib/utils';

/** Employee dashboard (PRD §33, §129): "what do I have to do?" in under five seconds. */
export default function EmployeeDashboardPage() {
  const me = useSession();
  const q = useQuery({
    queryKey: ['dashboard', 'employee'],
    queryFn: () => get<EmployeeDashboard>('/dashboard/employee'),
  });
  const now = new Date();
  const firstName = me.employee.fullName.split(' ')[0];

  return (
    <>
      <PageHeader title={`سلام ${firstName}`} description={`${formatWeekday(now)} ${formatDate(now)}`} />
      {q.isLoading && <Spinner />}
      {q.error && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data && <Content d={q.data} canAi={me.permissions.includes('ai.use')} />}
    </>
  );
}

function Content({ d, canAi }: { d: EmployeeDashboard; canAi: boolean }) {
  const s = d.summary;
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="وظایف فعال"
          value={faNum(s.active)}
          icon={<ClipboardList />}
          href="/tasks?scope=owned&status=open"
        />
        <StatTile
          label="سررسید امروز"
          value={faNum(s.dueToday)}
          icon={<Sun />}
          tone={s.dueToday ? 'warning' : 'default'}
        />
        <StatTile
          label="عقب‌افتاده"
          value={faNum(s.overdue)}
          icon={<AlertOctagon />}
          tone={s.overdue ? 'danger' : 'default'}
          href="/tasks?scope=owned&overdue=true"
        />
        <StatTile label="سه روز آینده" value={faNum(s.dueSoon)} icon={<CalendarClock />} tone="info" />
        <StatTile label="مسدود" value={faNum(s.blocked)} icon={<Ban />} tone={s.blocked ? 'danger' : 'default'} />
        <StatTile
          label="تکمیل در ۷ روز اخیر"
          value={faNum(s.completedThisWeek)}
          icon={<CheckCircle2 />}
          tone="success"
        />
      </div>

      {d.delayReasonRequired.length > 0 && (
        <Card className="border-danger/30 bg-danger-soft/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-danger">
              <FileWarning className="size-4" /> ثبت دلیل تأخیر لازم است
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TaskList tasks={d.delayReasonRequired} showOwner={false} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="grid gap-5 lg:col-span-2">
          <Section title="امروز" tasks={d.today} empty="برای امروز وظیفه‌ای سررسید نمی‌شود." />
          <Section title="عقب‌افتاده" tasks={d.overdue} empty="هیچ وظیفه عقب‌افتاده‌ای ندارید." />
          <Section
            title="نزدیک مهلت (۳ روز آینده)"
            tasks={d.dueSoon}
            empty="وظیفه‌ای در سه روز آینده سررسید نمی‌شود."
          />
          <Section title="اولویت بالا" tasks={d.highPriority} empty="وظیفه با اولویت بالا ندارید." limit={6} />
        </div>
        <div className="grid content-start gap-5">
          {canAi && <SummaryCard path="/ai/summary/daily" title="خلاصه روز من" />}
          <Section title="مسدود" tasks={d.blocked} empty="وظیفه مسدودی ندارید." compact />
          <Section
            title="همکاری در وظایف دیگران"
            tasks={d.collaborating}
            empty="در وظیفه‌ای همکار نیستید."
            compact
            owner
          />
          <Section
            title="اخیراً تکمیل‌شده"
            tasks={d.recentlyCompleted}
            empty="در هفته اخیر وظیفه‌ای تکمیل نشده."
            compact
          />
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  tasks,
  empty,
  limit,
  compact,
  owner,
}: {
  title: string;
  tasks: EmployeeDashboard['today'];
  empty: string;
  limit?: number;
  compact?: boolean;
  owner?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-4 sm:pt-5">
        <SectionTitle count={tasks.length}>{title}</SectionTitle>
        <TaskList
          tasks={tasks}
          empty={empty}
          showOwner={!!owner}
          limit={limit ?? (compact ? 5 : 8)}
          moreHref="/tasks?scope=mine&status=open"
        />
      </CardContent>
    </Card>
  );
}
