'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Bot, ShieldCheck, Wand2 } from 'lucide-react';
import type { WorkloadInsight } from '@karban/shared';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives';
import { PageHeader } from '@/components/ui/layout';
import { SummaryCard } from '@/components/insights/summary-card';
import { WorkloadBars } from '@/components/dashboard/widgets';
import { get } from '@/lib/api';
import { useAiStatus, useSession } from '@/lib/queries';

/** AI Insights hub (PRD §48–56). Every output is a suggestion for human review. */
export default function InsightsPage() {
  const me = useSession();
  const status = useAiStatus();
  const managerial = me.scopes.taskView !== 'self' || me.scopes.taskManage !== 'self';
  const workload = useQuery({
    queryKey: ['ai', 'workload', 'hub'],
    queryFn: () => get<WorkloadInsight>('/ai/workload'),
    enabled: managerial,
  });
  return (
    <>
      <PageHeader
        title="دستیار هوشمند"
        description="خلاصه‌ها، تحلیل ریسک و توزیع کار — برای کمک به تصمیم‌گیری، نه جایگزین آن."
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-4" /> وضعیت دستیار
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {status.data && (
              <div className="flex flex-wrap items-center gap-2">
                {status.data.enabled ? (
                  status.data.available ? (
                    <Badge variant="success">فعال</Badge>
                  ) : (
                    <Badge variant="warning">موقتاً در دسترس نیست</Badge>
                  )
                ) : (
                  <Badge>هوش مصنوعی پیکربندی نشده</Badge>
                )}
                {status.data.model && <span className="text-xs text-muted-foreground">مدل: {status.data.model}</span>}
              </div>
            )}
            <p className="leading-7 text-muted-foreground">
              {status.data?.enabled
                ? 'متن‌های تحلیلی با سرویس هوش مصنوعی تولید می‌شوند.'
                : 'بدون سرویس هوش مصنوعی، خلاصه‌ها، تحلیل ریسک و ایجاد وظیفه از متن با قواعد داخلی سامانه انجام می‌شود.'}
            </p>
            <Button asChild variant="secondary">
              <Link href="/tasks/new">
                <Wand2 /> ایجاد وظیفه از متن
              </Link>
            </Button>
          </CardContent>
        </Card>
        <SummaryCard path="/ai/summary/daily" title="خلاصه روز من" className="lg:col-span-2" />
        {managerial && <SummaryCard path="/ai/summary/manager" title="خلاصه تیم / واحد" className="lg:col-span-2" />}
        {me.scopes.report === 'all' && (
          <SummaryCard path="/ai/summary/executive" query={{ period: 'week' }} title="خلاصه هفتگی سازمان" />
        )}
        {managerial && workload.data && (
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>دستیار توزیع کار</CardTitle>
              <CardDescription>{workload.data.notes.join(' ')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-2">
              <div>
                <p className="mb-3 text-sm font-medium">بار کاری بالا</p>
                <WorkloadBars rows={workload.data.overloaded} />
              </div>
              <div>
                <p className="mb-3 text-sm font-medium">ظرفیت آزاد</p>
                <WorkloadBars rows={workload.data.underutilized} />
              </div>
            </CardContent>
          </Card>
        )}
        <Card className="lg:col-span-3 border-dashed">
          <CardContent className="flex gap-3 pt-5 text-sm leading-7 text-muted-foreground">
            <ShieldCheck className="mt-1 size-4 shrink-0 text-primary" />
            <p>
              اصول استفاده: دستیار هیچ تغییری را بدون تأیید شما ثبت نمی‌کند، کارکنان را امتیازدهی یا رتبه‌بندی نمی‌کند،
              تأخیر را به‌معنای ضعف عملکرد تلقی نمی‌کند و محتوای وظایف محرمانه را برای سرویس بیرونی ارسال نمی‌کند. ریسک
              تأخیر با قواعد شفاف محاسبه و دلایل آن روی هر وظیفه نمایش داده می‌شود.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
