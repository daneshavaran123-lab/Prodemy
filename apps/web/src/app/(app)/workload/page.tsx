'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { WORKLOAD_STATE_LABELS, type ManagerDashboard, type WorkloadInsight } from '@karban/shared';
import {
  Avatar,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui/primitives';
import { ErrorState, PageHeader, Spinner } from '@/components/ui/layout';
import { WorkloadBars } from '@/components/dashboard/widgets';
import { errorMessage, get } from '@/lib/api';
import { useSession } from '@/lib/queries';
import { faNum } from '@/lib/utils';

function WorkloadInner() {
  const me = useSession();
  const departmentId = useSearchParams().get('departmentId') ?? undefined;
  const q = useQuery({
    queryKey: ['dashboard', 'manager', departmentId ?? ''],
    queryFn: () => get<ManagerDashboard>('/dashboard/manager', { departmentId }),
  });
  const insight = useQuery({
    queryKey: ['ai', 'workload', departmentId],
    queryFn: () => get<WorkloadInsight>('/ai/workload', { departmentId }),
    enabled: me.permissions.includes('ai.use'),
  });
  return (
    <>
      <PageHeader title="حجم کار تیم" description={q.data ? `محدوده: ${q.data.scope.label}` : undefined} />
      {q.isLoading && <Spinner />}
      {q.error && <ErrorState message={errorMessage(q.error)} />}
      {q.data && (
        <div className="grid gap-5">
          {insight.data && (
            <Card className="border-info/30 bg-info-soft/40">
              <CardContent className="flex gap-3 pt-5 text-sm leading-7">
                <Info className="mt-1 size-4 shrink-0 text-info" />
                <ul className="grid gap-1">
                  {insight.data.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
            <Card>
              <CardHeader>
                <CardTitle>بار کاری نسبی</CardTitle>
              </CardHeader>
              <CardContent>
                <WorkloadBars rows={q.data.workload} limit={50} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>جزئیات به تفکیک فرد</CardTitle>
              </CardHeader>
              <CardContent className="px-0 sm:px-0">
                <Table>
                  <THead>
                    <TR>
                      <TH>نام</TH>
                      <TH>فعال</TH>
                      <TH>عقب‌افتاده</TH>
                      <TH>مسدود</TH>
                      <TH>اولویت بالا</TH>
                      <TH>این هفته</TH>
                      <TH>شاخص بار</TH>
                      <TH>وضعیت</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {q.data.workload.map((r) => (
                      <TR key={r.employee.id}>
                        <TD>
                          <Link
                            href={`/tasks?ownerId=${r.employee.id}&scope=visible`}
                            className="flex items-center gap-2 hover:text-primary"
                          >
                            <Avatar name={r.employee.fullName} className="size-7 text-[10px]" />
                            <span className="whitespace-nowrap">{r.employee.fullName}</span>
                          </Link>
                        </TD>
                        <TD className="tabular">{faNum(r.active)}</TD>
                        <TD className={r.overdue ? 'tabular text-danger' : 'tabular'}>{faNum(r.overdue)}</TD>
                        <TD className="tabular">{faNum(r.blocked)}</TD>
                        <TD className="tabular">{faNum(r.highPriority)}</TD>
                        <TD className="tabular">{faNum(r.dueThisWeek)}</TD>
                        <TD className="tabular">{r.loadIndex === null ? '—' : `${faNum(r.loadIndex, true)}×`}</TD>
                        <TD>
                          {r.onLeave ? (
                            <Badge>مرخصی</Badge>
                          ) : (
                            <Badge
                              variant={
                                r.state === 'OVERLOADED' ? 'warning' : r.state === 'UNDERUTILIZED' ? 'info' : 'neutral'
                              }
                            >
                              {WORKLOAD_STATE_LABELS[r.state]}
                            </Badge>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

export default function WorkloadPage() {
  return (
    <React.Suspense fallback={<Spinner />}>
      <WorkloadInner />
    </React.Suspense>
  );
}
