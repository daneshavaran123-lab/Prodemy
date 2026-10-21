import {
  Bell,
  Building2,
  ClipboardList,
  FileBarChart,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Network,
  PlugZap,
  Repeat,
  ScrollText,
  Settings,
  Sparkles,
  UserCog,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import type { SessionUser } from '@karban/shared';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match?: (path: string) => boolean;
}

export interface NavGroup {
  title?: string;
  items: NavItem[];
}

export function navFor(me: SessionUser): NavGroup[] {
  const can = (p: string) => me.permissions.includes(p);
  const managerial = me.scopes.taskView !== 'self' || me.scopes.taskManage !== 'self';
  const deptId = me.managesDepartmentIds[0] ?? me.employee.departmentId;
  const main: NavItem[] = [
    { href: '/dashboard', label: 'داشبورد من', icon: LayoutDashboard },
    { href: '/tasks', label: 'وظایف', icon: ClipboardList, match: (p) => p.startsWith('/tasks') },
  ];
  if (managerial) {
    main.push({ href: '/manager', label: 'داشبورد مدیریتی', icon: Gauge });
    main.push({ href: '/workload', label: 'حجم کار تیم', icon: UsersRound });
  }
  if (me.scopes.report === 'department' || me.managesDepartmentIds.length) {
    main.push({
      href: `/departments/${deptId}`,
      label: 'داشبورد دپارتمان',
      icon: Building2,
      match: (p) => p.startsWith('/departments'),
    });
  }
  if (me.scopes.report === 'all') {
    main.push({
      href: '/organization',
      label: 'داشبورد سازمان',
      icon: Network,
      match: (p) => p.startsWith('/organization') || p.startsWith('/departments'),
    });
  }
  main.push({ href: '/reports', label: 'گزارش‌ها', icon: FileBarChart });
  if (can('performance.view')) main.push({ href: '/performance', label: 'داده‌های عملکردی', icon: Users });
  if (can('ai.use')) main.push({ href: '/insights', label: 'دستیار هوشمند', icon: Sparkles });
  main.push({ href: '/recurring', label: 'وظایف تکراری', icon: Repeat });
  main.push({ href: '/notifications', label: 'اعلان‌ها', icon: Bell });

  const admin: NavItem[] = [];
  if (can('user.manage')) admin.push({ href: '/admin/users', label: 'کاربران', icon: UserCog });
  if (can('department.manage') || can('team.manage'))
    admin.push({ href: '/admin/org', label: 'دپارتمان‌ها و تیم‌ها', icon: Building2 });
  if (can('role.manage')) admin.push({ href: '/admin/roles', label: 'نقش‌ها و مجوزها', icon: KeyRound });
  if (can('integration.manage'))
    admin.push({ href: '/admin/integrations', label: 'یکپارچه‌سازی و اعلان‌ها', icon: PlugZap });
  if (can('settings.manage')) admin.push({ href: '/admin/settings', label: 'تنظیمات سیستم', icon: Settings });
  if (can('audit.view')) admin.push({ href: '/admin/audit', label: 'لاگ ممیزی', icon: ScrollText });

  return [{ items: main }, ...(admin.length ? [{ title: 'مدیریت سیستم', items: admin }] : [])];
}
