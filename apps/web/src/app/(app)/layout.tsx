'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, ClipboardList, LayoutDashboard, Menu, Plus } from 'lucide-react';
import { Dialog, SheetContent } from '@/components/ui/overlays';
import { Spinner } from '@/components/ui/layout';
import { SidebarNav } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { ApiError } from '@/lib/api';
import { qk, useMe, useUnreadCount } from '@/lib/queries';
import { cn, faNum } from '@/lib/utils';

function MobileTabs({ onMenu }: { onMenu: () => void }) {
  const path = usePathname();
  const unread = useUnreadCount().data?.count ?? 0;
  const tab = (href: string, label: string, Icon: typeof Bell, active: boolean, badge?: number) => (
    <Link
      href={href}
      className={cn(
        'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]',
        active ? 'text-primary' : 'text-muted-foreground',
      )}
    >
      <span className="relative">
        <Icon className="size-5" />
        {!!badge && (
          <span className="absolute -top-1 -end-2 rounded-full bg-danger px-1 text-[9px] font-bold leading-4 text-white">
            {faNum(badge)}
          </span>
        )}
      </span>
      {label}
    </Link>
  );
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
      aria-label="منوی سریع"
    >
      {tab('/dashboard', 'داشبورد', LayoutDashboard, path === '/dashboard')}
      {tab('/tasks', 'وظایف', ClipboardList, path === '/tasks')}
      <Link href="/tasks/new" className="flex flex-1 items-center justify-center" aria-label="وظیفه جدید">
        <span className="-mt-5 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
          <Plus className="size-6" />
        </span>
      </Link>
      {tab('/notifications', 'اعلان‌ها', Bell, path === '/notifications', unread)}
      <button
        onClick={onMenu}
        className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground cursor-pointer"
      >
        <Menu className="size-5" />
        منو
      </button>
    </nav>
  );
}

/** Authenticated shell: session gate, sidebar, top bar and mobile tab bar. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const qc = useQueryClient();
  const me = useMe();
  const [menuOpen, setMenuOpen] = React.useState(false);

  React.useEffect(() => {
    const onUnauthorized = () => {
      qc.removeQueries({ queryKey: qk.me });
      router.replace(`/login?next=${encodeURIComponent(path)}`);
    };
    window.addEventListener('karban:unauthorized', onUnauthorized);
    return () => window.removeEventListener('karban:unauthorized', onUnauthorized);
  }, [qc, router, path]);

  React.useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) {
      router.replace(`/login?next=${encodeURIComponent(path)}`);
    }
  }, [me.error, router, path]);

  React.useEffect(() => {
    if (me.data?.mustChangePassword && path !== '/profile') router.replace('/profile?changePassword=1');
  }, [me.data?.mustChangePassword, path, router]);

  if (!me.data) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner
          label={
            me.error && !(me.error instanceof ApiError && me.error.status === 401)
              ? 'ارتباط با سرور برقرار نشد…'
              : 'در حال بارگذاری…'
          }
        />
      </div>
    );
  }

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-e bg-sidebar lg:block">
        <SidebarNav me={me.data} />
      </aside>
      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent title="منو">
          <SidebarNav me={me.data} onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Dialog>
      <div className="flex min-w-0 flex-col">
        <Topbar me={me.data} onMenu={() => setMenuOpen(true)} />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-24 pt-5 sm:px-6 lg:pb-10">{children}</main>
      </div>
      <MobileTabs onMenu={() => setMenuOpen(true)} />
    </div>
  );
}
