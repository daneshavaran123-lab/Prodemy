import { cn } from '@/lib/utils';

/** Karban mark: a kanban card with a check, in the primary color. */
export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-bold', className)}>
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" fill="var(--color-primary)" />
        <rect x="7" y="8" width="7" height="16" rx="2" fill="var(--color-primary-foreground)" opacity="0.55" />
        <rect x="17" y="8" width="8" height="10" rx="2" fill="var(--color-primary-foreground)" />
        <path
          d="M18.8 13.1l1.7 1.7 3.1-3.3"
          stroke="var(--color-primary)"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {withText && <span className="text-lg tracking-tight">کاربان</span>}
    </span>
  );
}
