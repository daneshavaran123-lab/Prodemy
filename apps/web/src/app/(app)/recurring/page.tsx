'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pause, Play, Repeat } from 'lucide-react';
import { RECURRENCE_LABELS, WEEKDAY_LABELS, WEEK_ORDER, type RecurrenceDto } from '@karban/shared';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, Table, TBody, TD, TH, THead, TR } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PageHeader, Spinner } from '@/components/ui/layout';
import { PriorityBadge } from '@/components/tasks/badges';
import { errorMessage, get, patch } from '@/lib/api';
import { faNum, formatDate } from '@/lib/utils';

function describe(r: RecurrenceDto): string {
  const every = r.interval > 1 ? `هر ${faNum(r.interval)} ` : '';
  switch (r.frequency) {
    case 'DAILY':
      return 'هر روز کاری';
    case 'WEEKLY':
      return `${every ? `${every}هفته` : 'هر هفته'} — ${WEEK_ORDER.filter((d) => r.weekdays.includes(d))
        .map((d) => WEEKDAY_LABELS[d])
        .join('، ')}`;
    case 'MONTHLY':
      return `${every ? `${every}ماه` : 'هر ماه'}${r.dayOfMonth ? ` — روز ${faNum(r.dayOfMonth)} ماه` : ''}`;
    default:
      return `هر ${faNum(r.interval)} روز`;
  }
}

export default function RecurringPage() {
  const q = useQuery({ queryKey: ['recurrences'], queryFn: () => get<RecurrenceDto[]>('/recurrences') });
  const toggle = useMutation({
    mutationFn: (r: RecurrenceDto) => patch<RecurrenceDto>(`/recurrences/${r.id}`, { active: !r.active }),
    onSuccess: (r) => {
      q.refetch();
      toast.success(r.active ? 'تکرار فعال شد.' : 'تکرار متوقف شد.');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <PageHeader
        title="وظایف تکراری"
        description="الگوهایی که در هر سررسید، یک نمونه وظیفه جدید ایجاد می‌کنند. برای ایجاد الگوی جدید، هنگام ساخت وظیفه گزینه «وظیفه تکراری» را فعال کنید."
      />
      {q.isLoading && <Spinner />}
      {q.error && <ErrorState message={errorMessage(q.error)} />}
      {q.data?.length === 0 && <EmptyState icon={<Repeat />} title="وظیفه تکراری‌ای وجود ندارد." />}
      {!!q.data?.length && (
        <Card>
          <CardContent className="px-0 sm:px-0">
            <Table>
              <THead>
                <TR>
                  <TH>عنوان</TH>
                  <TH>تکرار</TH>
                  <TH>مسئول</TH>
                  <TH>اولویت</TH>
                  <TH>نمونه بعدی</TH>
                  <TH>نمونه‌ها</TH>
                  <TH>وضعیت</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {q.data.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <p className="font-medium">{r.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.department.name} · {RECURRENCE_LABELS[r.frequency]}
                      </p>
                    </TD>
                    <TD className="text-sm">{describe(r)}</TD>
                    <TD className="whitespace-nowrap">{r.primaryOwner.fullName}</TD>
                    <TD>
                      <PriorityBadge priority={r.priority} />
                    </TD>
                    <TD className="whitespace-nowrap">
                      {r.active && r.nextRunAt ? formatDate(`${r.nextRunAt}T12:00:00Z`) : '—'}
                    </TD>
                    <TD className="tabular">{faNum(r.instanceCount)}</TD>
                    <TD>{r.active ? <Badge variant="success">فعال</Badge> : <Badge>متوقف</Badge>}</TD>
                    <TD>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggle.mutate(r)}
                        loading={toggle.isPending && toggle.variables?.id === r.id}
                      >
                        {r.active ? <Pause /> : <Play />} {r.active ? 'توقف' : 'فعال‌سازی'}
                      </Button>
                    </TD>
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
