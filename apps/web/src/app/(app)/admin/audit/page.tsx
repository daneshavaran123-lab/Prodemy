'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AUDIT_ACTION_LABELS, type AuditAction, type AuditLogDto, type Paginated } from '@karban/shared';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, Field, Table, TBody, TD, TH, THead, TR } from '@/components/ui/primitives';
import { Select } from '@/components/ui/overlays';
import { DatePicker } from '@/components/ui/date-picker';
import { ErrorState, PageHeader, Spinner } from '@/components/ui/layout';
import { errorMessage, get } from '@/lib/api';
import { faNum, formatDateTime } from '@/lib/utils';

const SECURITY: AuditAction[] = [
  'LOGIN_FAILED',
  'ACCESS_DENIED',
  'PERMISSION_CHANGED',
  'ROLE_CHANGED',
  'USER_DISABLED',
];
const ERRORS: AuditAction[] = ['INTEGRATION_ERROR', 'AI_ERROR', 'NOTIFICATION_FAILURE'];

export default function AuditPage() {
  const [action, setAction] = React.useState('');
  const [from, setFrom] = React.useState<string | null>(null);
  const [to, setTo] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(1);
  const [open, setOpen] = React.useState<string | null>(null);
  const q = useQuery({
    queryKey: ['admin', 'audit', action, from, to, page],
    queryFn: () =>
      get<Paginated<AuditLogDto>>('/audit-logs', {
        action: action || undefined,
        from: from ?? undefined,
        to: to ?? undefined,
        page,
        pageSize: 50,
      }),
  });
  return (
    <>
      <PageHeader
        title="لاگ ممیزی"
        description="ورودها، تغییرات کاربران و مجوزها، دسترسی‌های غیرمجاز، خروجی داده و خطاهای یکپارچه‌سازی"
      />
      <Card className="mb-4">
        <CardContent className="grid gap-3 pt-4 sm:grid-cols-4 sm:pt-4">
          <Field label="نوع رویداد">
            <Select
              value={action}
              onValueChange={(v) => {
                setAction(v);
                setPage(1);
              }}
              options={(Object.keys(AUDIT_ACTION_LABELS) as AuditAction[]).map((a) => ({
                value: a,
                label: AUDIT_ACTION_LABELS[a],
              }))}
              allowClear
              clearLabel="همه رویدادها"
              placeholder="همه رویدادها"
            />
          </Field>
          <Field label="از تاریخ">
            <DatePicker value={from} onChange={setFrom} defaultTime="00:00" clearable />
          </Field>
          <Field label="تا تاریخ">
            <DatePicker value={to} onChange={setTo} clearable />
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
                  <TH>زمان</TH>
                  <TH>رویداد</TH>
                  <TH>کاربر</TH>
                  <TH>موجودیت</TH>
                  <TH>IP</TH>
                  <TH>جزئیات</TH>
                </TR>
              </THead>
              <TBody>
                {q.data.items.map((l) => (
                  <React.Fragment key={l.id}>
                    <TR>
                      <TD className="whitespace-nowrap text-xs">{formatDateTime(l.createdAt)}</TD>
                      <TD>
                        <Badge
                          variant={
                            SECURITY.includes(l.action) ? 'warning' : ERRORS.includes(l.action) ? 'danger' : 'neutral'
                          }
                        >
                          {AUDIT_ACTION_LABELS[l.action]}
                        </Badge>
                      </TD>
                      <TD className="whitespace-nowrap">
                        {l.actor ? `${l.actor.fullName ?? ''} (${l.actor.username})` : '—'}
                      </TD>
                      <TD className="text-xs text-muted-foreground" dir="ltr">
                        {l.entityType ?? ''}
                      </TD>
                      <TD className="text-xs text-muted-foreground" dir="ltr">
                        {l.ip ?? ''}
                      </TD>
                      <TD>
                        {l.metadata ? (
                          <Button variant="link" size="sm" onClick={() => setOpen(open === l.id ? null : l.id)}>
                            {open === l.id ? 'بستن' : 'نمایش'}
                          </Button>
                        ) : null}
                      </TD>
                    </TR>
                    {open === l.id && (
                      <TR>
                        <TD colSpan={6}>
                          <pre dir="ltr" className="max-h-60 overflow-auto rounded-md bg-muted p-3 text-xs">
                            {JSON.stringify(l.metadata, null, 2)}
                          </pre>
                        </TD>
                      </TR>
                    )}
                  </React.Fragment>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {q.data && q.data.total > 50 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            قبلی
          </Button>
          <span className="text-muted-foreground">
            صفحه {faNum(page)} از {faNum(Math.ceil(q.data.total / 50))}
          </span>
          <Button variant="outline" size="sm" disabled={page * 50 >= q.data.total} onClick={() => setPage(page + 1)}>
            بعدی
          </Button>
        </div>
      )}
    </>
  );
}
