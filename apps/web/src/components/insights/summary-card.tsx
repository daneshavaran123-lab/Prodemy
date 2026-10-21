'use client';

import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Sparkles } from 'lucide-react';
import type { AiSummary } from '@karban/shared';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { get } from '@/lib/api';
import { timeAgo } from '@/lib/utils';

/**
 * Summary card: the deterministic summary is always shown; the AI narrative is an
 * enhancement that may be unavailable (PRD §59, §92).
 */
export function SummaryCard({
  path,
  query,
  title = 'خلاصه هوشمند',
  className,
}: {
  path: string;
  query?: Record<string, string | undefined>;
  title?: string;
  className?: string;
}) {
  const q = useQuery({
    queryKey: ['ai', 'summary', path, query],
    queryFn: () => get<AiSummary>(path, query),
    staleTime: 5 * 60_000,
  });
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" /> {title}
        </CardTitle>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => q.refetch()}
          aria-label="به‌روزرسانی خلاصه"
          disabled={q.isFetching}
        >
          <RefreshCw className={q.isFetching ? 'animate-spin' : ''} />
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm leading-7">
        {q.isLoading && (
          <div className="grid gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        )}
        {q.data && (
          <>
            {q.data.aiText ? <p className="whitespace-pre-line">{q.data.aiText}</p> : <p>{q.data.text}</p>}
            {q.data.highlights.length > 0 && (
              <ul className="grid gap-1 border-s-2 border-primary/30 ps-3 text-xs text-muted-foreground">
                {q.data.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-muted-foreground">
              {q.data.aiText
                ? 'تولیدشده با دستیار هوش مصنوعی — جهت بررسی انسانی'
                : (q.data.aiError ?? 'خلاصه خودکار بر اساس داده‌های سامانه')}
              {' · '}
              {timeAgo(q.data.generatedAt)}
            </p>
          </>
        )}
        {q.error && <p className="text-muted-foreground">خلاصه در حال حاضر در دسترس نیست.</p>}
      </CardContent>
    </Card>
  );
}
