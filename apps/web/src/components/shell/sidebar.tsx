'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { SessionUser } from '@karban/shared';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/brand/logo';
import { navFor } from './nav';

export function SidebarNav({ me, onNavigate }: { me: SessionUser; onNavigate?: () => void }) {
  const path = usePathname();
  const groups = navFor(me);
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <Link href="/dashboard" onClick={onNavigate}>
          <Logo />
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4 scrollbar-thin" aria-label="منوی اصلی">
        {groups.map((g, i) => (
          <div key={i} className={cn(i > 0 && 'mt-6')}>
            {g.title && <p className="mb-2 px-3 text-xs font-medium text-muted-foreground">{g.title}</p>}
            <ul className="grid gap-0.5">
              {g.items.map((item) => {
                const active = item.match ? item.match(path) : path === item.href;
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                        active
                          ? 'bg-accent font-medium text-accent-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t px-5 py-3 text-xs text-muted-foreground">
        {me.employee.departmentName} · {me.role.name}
      </div>
    </div>
  );
}
