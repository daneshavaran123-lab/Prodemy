'use client';

import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bot, Database, HardDrive, Mail, RotateCw, Send } from 'lucide-react';
import {
  type DeliveryStatus,
  type IntegrationStatus,
  type NotificationDeliveryDto,
  type Paginated,
} from '@karban/shared';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui/primitives';
import { Select } from '@/components/ui/overlays';
import { ErrorState, PageHeader, Spinner } from '@/components/ui/layout';
import { errorMessage, get, post } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

const ok = (v: boolean, yes = 'فعال', no = 'پیکربندی نشده') => (
  <Badge variant={v ? 'success' : 'neutral'}>{v ? yes : no}</Badge>
);
const DELIVERY_LABELS: Record<DeliveryStatus, string> = {
  PENDING: 'در صف',
  SENT: 'ارسال‌شده',
  FAILED: 'ناموفق',
  SKIPPED: 'رد شده',
  DIGESTED: 'در خلاصه روزانه',
};

export default function IntegrationsPage() {
  const status = useQuery({
    queryKey: ['admin', 'integrations'],
    queryFn: () => get<IntegrationStatus>('/integrations/status'),
  });
  const [filter, setFilter] = React.useState<string>('FAILED');
  const deliveries = useQuery({
    queryKey: ['admin', 'deliveries', filter],
    queryFn: () =>
      get<Paginated<NotificationDeliveryDto>>('/notifications/deliveries', {
        status: filter || undefined,
        pageSize: 50,
      }),
  });
  const [to, setTo] = React.useState('');
  const testEmail = useMutation({
    mutationFn: () => post('/integrations/email/test', { to }),
    onSuccess: () => toast.success('ایمیل آزمایشی ارسال شد.'),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const testAi = useMutation({
    mutationFn: () => post<{ ok: boolean; model?: string; error?: string }>('/integrations/ai/test'),
    onSuccess: (r) =>
      r.ok ? toast.success(`اتصال برقرار است (${r.model}).`) : toast.error(`اتصال ناموفق: ${r.error}`),
  });
  const retry = useMutation({
    mutationFn: (id: string) => post(`/notifications/deliveries/${id}/retry`),
    onSuccess: () => {
      toast.success('ارسال مجدد در صف قرار گرفت.');
      deliveries.refetch();
    },
  });
  const s = status.data;
  return (
    <>
      <PageHeader
        title="یکپارچه‌سازی و اعلان‌ها"
        description="وضعیت سرویس‌های بیرونی. مقادیر محرمانه (توکن‌ها، کلیدها) فقط در متغیرهای محیطی سرور نگهداری می‌شوند."
      />
      {status.isLoading && <Spinner />}
      {status.error && <ErrorState message={errorMessage(status.error)} />}
      {s && (
        <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="size-4" /> ایمیل (SMTP)
              </CardTitle>
              <CardDescription dir="ltr" className="text-end">
                {s.email.host ?? '—'}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {ok(s.email.configured)}
              {s.email.configured && (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    testEmail.mutate();
                  }}
                >
                  <Input
                    dir="ltr"
                    type="email"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder="test@example.com"
                    required
                  />
                  <Button size="md" variant="outline" loading={testEmail.isPending}>
                    آزمایش
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="size-4" /> تلگرام
              </CardTitle>
              <CardDescription>
                {s.telegram.botUsername ? `@${s.telegram.botUsername} · ${s.telegram.mode}` : s.telegram.mode}
              </CardDescription>
            </CardHeader>
            <CardContent>{ok(s.telegram.configured)}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="size-4" /> هوش مصنوعی
              </CardTitle>
              <CardDescription dir="ltr" className="text-end">
                {s.ai.provider} {s.ai.model ? `· ${s.ai.model}` : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2">
              {s.ai.enabled
                ? ok(s.ai.available, 'در دسترس', 'موقتاً در دسترس نیست')
                : ok(false, '', 'غیرفعال (قواعد داخلی)')}
              {s.ai.enabled && (
                <Button size="sm" variant="outline" onClick={() => testAi.mutate()} loading={testAi.isPending}>
                  آزمایش اتصال
                </Button>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="size-4" /> ذخیره‌سازی و صف
              </CardTitle>
              <CardDescription>{s.storage.driver === 's3' ? `S3 · ${s.storage.bucket}` : 'دیسک محلی'}</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-2">
              <Database className="size-4 text-muted-foreground" /> صف کارها: {ok(s.queue.connected, 'متصل', 'قطع')}
            </CardContent>
          </Card>
        </div>
      )}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>گزارش ارسال اعلان‌ها</CardTitle>
            <CardDescription>ارسال‌های ناموفق ثبت می‌شوند و اعلان درون‌برنامه همیشه در دسترس می‌ماند.</CardDescription>
          </div>
          <div className="w-44">
            <Select
              value={filter}
              onValueChange={setFilter}
              options={(Object.keys(DELIVERY_LABELS) as DeliveryStatus[]).map((k) => ({
                value: k,
                label: DELIVERY_LABELS[k],
              }))}
              allowClear
              clearLabel="همه"
            />
          </div>
        </CardHeader>
        <CardContent className="px-0 sm:px-0">
          {deliveries.data && deliveries.data.items.length === 0 && (
            <p className="px-5 pb-4 text-sm text-muted-foreground">موردی یافت نشد.</p>
          )}
          {!!deliveries.data?.items.length && (
            <Table>
              <THead>
                <TR>
                  <TH>اعلان</TH>
                  <TH>کانال</TH>
                  <TH>وضعیت</TH>
                  <TH>تلاش</TH>
                  <TH>خطا</TH>
                  <TH>زمان</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {deliveries.data.items.map((d) => (
                  <TR key={d.id}>
                    <TD className="max-w-64 truncate">{d.notification.title}</TD>
                    <TD>{d.channel === 'EMAIL' ? 'ایمیل' : d.channel === 'TELEGRAM' ? 'تلگرام' : 'درون‌برنامه'}</TD>
                    <TD>
                      <Badge variant={d.status === 'FAILED' ? 'danger' : d.status === 'SENT' ? 'success' : 'neutral'}>
                        {DELIVERY_LABELS[d.status]}
                      </Badge>
                    </TD>
                    <TD className="tabular">{d.attempts.toLocaleString('fa-IR')}</TD>
                    <TD className="max-w-72 truncate text-xs text-muted-foreground" dir="ltr">
                      {d.error ?? ''}
                    </TD>
                    <TD className="whitespace-nowrap text-xs">{formatDateTime(d.createdAt)}</TD>
                    <TD>
                      {d.status === 'FAILED' && (
                        <Button size="sm" variant="ghost" onClick={() => retry.mutate(d.id)}>
                          <RotateCw /> ارسال مجدد
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
