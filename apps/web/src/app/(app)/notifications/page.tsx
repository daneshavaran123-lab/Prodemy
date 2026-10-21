'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { NOTIFICATION_TYPE_LABELS, type NotificationDto, type Paginated } from '@karban/shared';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PageHeader, Spinner } from '@/components/ui/layout';
import { errorMessage, get, post } from '@/lib/api';
import { cn, faNum, formatDateTime, timeAgo } from '@/lib/utils';

export default function NotificationsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const q = useQuery({
    queryKey: ['notifications', 'page', unreadOnly, page],
    queryFn: () => get<Paginated<NotificationDto>>('/notifications', { unreadOnly, page, pageSize: 30 }),
  });
  const readAll = useMutation({
    mutationFn: () => post('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const open = async (n: NotificationDto) => {
    if (!n.readAt) {
      await post(`/notifications/${n.id}/read`).catch(() => undefined);
      qc.invalidateQueries({ queryKey: ['notifications'] });
    }
    if (n.link) router.push(n.link);
  };
  const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / 30));
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="اعلان‌ها"
        actions={
          <>
            <div className="flex gap-1 rounded-md bg-muted p-0.5 text-sm">
              {[false, true].map((v) => (
                <button
                  key={String(v)}
                  onClick={() => {
                    setUnreadOnly(v);
                    setPage(1);
                  }}
                  className={cn('rounded px-3 py-1 cursor-pointer', unreadOnly === v && 'bg-card shadow-sm')}
                >
                  {v ? 'خوانده‌نشده' : 'همه'}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={() => readAll.mutate()} loading={readAll.isPending}>
              <CheckCheck /> خواندن همه
            </Button>
          </>
        }
      />
      {q.isLoading && <Spinner />}
      {q.error && <ErrorState message={errorMessage(q.error)} />}
      {q.data && q.data.items.length === 0 && (
        <EmptyState title={unreadOnly ? 'اعلان خوانده‌نشده‌ای ندارید.' : 'هنوز اعلانی ندارید.'} />
      )}
      {q.data && q.data.items.length > 0 && (
        <Card>
          <CardContent className="px-0 py-0 sm:px-0 sm:py-0">
            <ul className="divide-y">
              {q.data.items.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => open(n)}
                    className={cn(
                      'flex w-full gap-3 px-5 py-4 text-start hover:bg-muted/50 cursor-pointer',
                      !n.readAt && 'bg-accent/30',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-2 size-2 shrink-0 rounded-full',
                        n.readAt ? 'bg-transparent' : n.priority === 'CRITICAL' ? 'bg-danger' : 'bg-primary',
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{n.title}</span>
                        <Badge variant={n.priority === 'CRITICAL' ? 'danger' : 'neutral'}>
                          {NOTIFICATION_TYPE_LABELS[n.type]}
                        </Badge>
                      </span>
                      <span className="mt-1 block whitespace-pre-line text-sm leading-7 text-muted-foreground">
                        {n.body}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground" title={formatDateTime(n.createdAt)}>
                        {timeAgo(n.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <Button
            variant="outline"
            size="icon-sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            aria-label="صفحه قبل"
          >
            <ChevronRight />
          </Button>
          <span className="tabular text-muted-foreground">
            صفحه {faNum(page)} از {faNum(pages)}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
            aria-label="صفحه بعد"
          >
            <ChevronLeft />
          </Button>
        </div>
      )}
    </div>
  );
}
