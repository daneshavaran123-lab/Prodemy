'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, LogOut, Menu, Monitor, Moon, Plus, Search, Sun, User } from 'lucide-react';
import type { NotificationDto, Paginated, SessionUser } from '@karban/shared';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/primitives';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/overlays';
import { useTheme } from '@/components/providers';
import { get, post } from '@/lib/api';
import { useUnreadCount } from '@/lib/queries';
import { cn, faNum, timeAgo } from '@/lib/utils';

function NotificationBell() {
  const router = useRouter();
  const qc = useQueryClient();
  const unread = useUnreadCount();
  const [open, setOpen] = React.useState(false);
  const list = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () => get<Paginated<NotificationDto>>('/notifications', { pageSize: 8 }),
    enabled: open,
  });
  const count = unread.data?.count ?? 0;

  const openItem = async (n: NotificationDto) => {
    setOpen(false);
    if (!n.readAt) {
      await post(`/notifications/${n.id}/read`).catch(() => undefined);
      qc.invalidateQueries({ queryKey: ['notifications'] });
    }
    if (n.link) router.push(n.link);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`اعلان‌ها${count ? ` (${faNum(count)} خوانده‌نشده)` : ''}`}
        >
          <Bell />
          {count > 0 && (
            <span className="absolute -top-0.5 -end-0.5 flex min-w-4.5 h-4.5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
              {count > 99 ? '۹۹+' : faNum(count)}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-semibold">اعلان‌ها</span>
          {count > 0 && (
            <button
              className="text-xs text-primary hover:underline cursor-pointer"
              onClick={async () => {
                await post('/notifications/read-all');
                qc.invalidateQueries({ queryKey: ['notifications'] });
              }}
            >
              علامت‌گذاری همه به‌عنوان خوانده‌شده
            </button>
          )}
        </div>
        <ul className="max-h-96 overflow-y-auto scrollbar-thin">
          {list.data?.items.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">اعلانی وجود ندارد.</li>
          )}
          {list.data?.items.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => openItem(n)}
                className={cn(
                  'flex w-full gap-3 px-4 py-3 text-start hover:bg-muted cursor-pointer',
                  !n.readAt && 'bg-accent/40',
                )}
              >
                <span
                  className={cn(
                    'mt-1.5 size-2 shrink-0 rounded-full',
                    n.readAt ? 'bg-transparent' : n.priority === 'CRITICAL' ? 'bg-danger' : 'bg-primary',
                  )}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{n.title}</span>
                  <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-muted-foreground">{n.body}</span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <Link
          href="/notifications"
          onClick={() => setOpen(false)}
          className="block border-t px-4 py-2.5 text-center text-sm text-primary hover:bg-muted"
        >
          مشاهده همه اعلان‌ها
        </Link>
      </PopoverContent>
    </Popover>
  );
}

function UserMenu({ me }: { me: SessionUser }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { theme, setTheme } = useTheme();
  const logout = async () => {
    await post('/auth/logout').catch(() => undefined);
    qc.clear();
    router.replace('/login');
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 rounded-md p-1 hover:bg-muted cursor-pointer"
          aria-label="منوی کاربر"
        >
          <Avatar name={me.employee.fullName} />
          <span className="hidden text-start leading-tight md:block">
            <span className="block text-sm font-medium">{me.employee.fullName}</span>
            <span className="block text-xs text-muted-foreground">{me.employee.jobTitle ?? me.role.name}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>{me.username}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => router.push('/profile')}>
          <User /> پروفایل و تنظیمات
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>پوسته</DropdownMenuLabel>
        {(
          [
            ['light', 'روشن', Sun],
            ['dark', 'تیره', Moon],
            ['system', 'مطابق سیستم', Monitor],
          ] as const
        ).map(([value, label, Icon]) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => setTheme(value)}
            className={cn(theme === value && 'font-semibold text-primary')}
          >
            <Icon /> {label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={logout}>
          <LogOut /> خروج
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Topbar({ me, onMenu }: { me: SessionUser; onMenu: () => void }) {
  const router = useRouter();
  const [q, setQ] = React.useState('');
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur sm:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenu} aria-label="باز کردن منو">
        <Menu />
      </Button>
      <form
        className="relative hidden max-w-md flex-1 sm:block"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) router.push(`/tasks?q=${encodeURIComponent(q.trim())}`);
        }}
        role="search"
      >
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="جستجوی وظیفه، کد، فرد یا برچسب…"
          aria-label="جستجو"
          className="h-9 w-full rounded-md border border-input bg-card ps-9 pe-3 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </form>
      <div className="ms-auto flex items-center gap-1 sm:gap-2">
        <Button asChild size="sm" className="hidden sm:inline-flex">
          <Link href="/tasks/new">
            <Plus /> وظیفه جدید
          </Link>
        </Button>
        <NotificationBell />
        <UserMenu me={me} />
      </div>
    </header>
  );
}
