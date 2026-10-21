import * as React from 'react';
import { Inbox, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-bold leading-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center',
        className,
      )}
    >
      <div className="text-muted-foreground [&_svg]:size-8">{icon ?? <Inbox />}</div>
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Spinner({ className, label = 'در حال بارگذاری…' }: { className?: string; label?: string }) {
  return (
    <div
      className={cn('flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground', className)}
      role="status"
    >
      <Loader2 className="size-5 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
      {message}
      {onRetry && (
        <button onClick={onRetry} className="ms-3 font-medium underline underline-offset-4 cursor-pointer">
          تلاش مجدد
        </button>
      )}
    </div>
  );
}

/** Stat tile (label · value · optional hint), per the data-viz figure contract. */
export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = 'default',
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'default' | 'danger' | 'warning' | 'success' | 'info';
  href?: string;
}) {
  const toneClass = {
    default: 'text-muted-foreground bg-muted',
    danger: 'text-danger bg-danger-soft',
    warning: 'text-warning bg-warning-soft',
    success: 'text-success bg-success-soft',
    info: 'text-info bg-info-soft',
  }[tone];
  const body = (
    <div className="flex h-full items-start justify-between gap-3 rounded-lg border bg-card p-4 shadow-xs transition-colors hover:border-input">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground sm:text-sm">{label}</p>
        <p className="mt-1.5 text-2xl font-semibold leading-none">{value}</p>
        {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {icon && <span className={cn('rounded-lg p-2 [&_svg]:size-4', toneClass)}>{icon}</span>}
    </div>
  );
  return href ? (
    <a href={href} className="block focus-visible:rounded-lg">
      {body}
    </a>
  ) : (
    body
  );
}

export function SectionTitle({
  children,
  action,
  count,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  count?: number;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        {children}
        {count !== undefined && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {count.toLocaleString('fa-IR')}
          </span>
        )}
      </h2>
      {action}
    </div>
  );
}
