/**
 * Permission codes (PRD §11–12). Roles are data (admin-configurable); the backend
 * only ever checks permission codes, never role names.
 *
 * Task visibility/management scopes are layered: self < team < department < all.
 */
export const Permission = {
  TASK_CREATE_SELF: 'task.create.self',
  TASK_VIEW_TEAM: 'task.view.team',
  TASK_VIEW_DEPARTMENT: 'task.view.department',
  TASK_VIEW_ALL: 'task.view.all',
  TASK_MANAGE_TEAM: 'task.manage.team',
  TASK_MANAGE_DEPARTMENT: 'task.manage.department',
  TASK_MANAGE_ALL: 'task.manage.all',
  REPORT_VIEW_TEAM: 'report.view.team',
  REPORT_VIEW_DEPARTMENT: 'report.view.department',
  REPORT_VIEW_ALL: 'report.view.all',
  PERFORMANCE_VIEW: 'performance.view',
  PERFORMANCE_EXPORT: 'performance.export',
  PROJECT_MANAGE: 'project.manage',
  AI_USE: 'ai.use',
  USER_MANAGE: 'user.manage',
  DEPARTMENT_MANAGE: 'department.manage',
  TEAM_MANAGE: 'team.manage',
  ROLE_MANAGE: 'role.manage',
  SETTINGS_MANAGE: 'settings.manage',
  INTEGRATION_MANAGE: 'integration.manage',
  AUDIT_VIEW: 'audit.view',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(Permission);

export const PERMISSION_LABELS: Record<Permission, string> = {
  'task.create.self': 'ایجاد وظیفه شخصی',
  'task.view.team': 'مشاهده وظایف تیم',
  'task.view.department': 'مشاهده وظایف دپارتمان',
  'task.view.all': 'مشاهده وظایف کل سازمان',
  'task.manage.team': 'ایجاد و مدیریت وظایف تیم',
  'task.manage.department': 'ایجاد و مدیریت وظایف دپارتمان',
  'task.manage.all': 'ایجاد و مدیریت وظایف کل سازمان',
  'report.view.team': 'گزارش‌های تیم',
  'report.view.department': 'گزارش‌های دپارتمان',
  'report.view.all': 'گزارش‌های سازمان',
  'performance.view': 'مشاهده داده‌های عملکردی',
  'performance.export': 'خروجی داده‌های عملکردی',
  'project.manage': 'مدیریت پروژه‌ها',
  'ai.use': 'استفاده از دستیار هوش مصنوعی',
  'user.manage': 'مدیریت کاربران',
  'department.manage': 'مدیریت دپارتمان‌ها',
  'team.manage': 'مدیریت تیم‌ها',
  'role.manage': 'مدیریت نقش‌ها و مجوزها',
  'settings.manage': 'مدیریت تنظیمات سیستم',
  'integration.manage': 'مدیریت یکپارچه‌سازی‌ها',
  'audit.view': 'مشاهده لاگ ممیزی',
};

export const RoleCode = {
  EMPLOYEE: 'employee',
  SUPERVISOR: 'supervisor',
  DEPARTMENT_MANAGER: 'department_manager',
  HR: 'hr',
  HR_MANAGER: 'hr_manager',
  CEO: 'ceo',
  ADMIN: 'admin',
} as const;
export type RoleCode = (typeof RoleCode)[keyof typeof RoleCode];

const P = Permission;
const EMPLOYEE_BASE: Permission[] = [P.TASK_CREATE_SELF, P.AI_USE];
const SUPERVISOR: Permission[] = [...EMPLOYEE_BASE, P.TASK_VIEW_TEAM, P.TASK_MANAGE_TEAM, P.REPORT_VIEW_TEAM];
const DEPARTMENT_MANAGER: Permission[] = [
  ...SUPERVISOR,
  P.TASK_VIEW_DEPARTMENT,
  P.TASK_MANAGE_DEPARTMENT,
  P.REPORT_VIEW_DEPARTMENT,
  P.PROJECT_MANAGE,
];

/** Default role definitions seeded on first install (PRD §12 access matrix). */
export const DEFAULT_ROLES: ReadonlyArray<{
  code: RoleCode;
  name: string;
  description: string;
  permissions: Permission[];
}> = [
  {
    code: RoleCode.EMPLOYEE,
    name: 'کارمند',
    description: 'مشاهده و انجام وظایف خود، ایجاد وظیفه شخصی',
    permissions: EMPLOYEE_BASE,
  },
  {
    code: RoleCode.SUPERVISOR,
    name: 'سرپرست / سرتیم',
    description: 'ایجاد، تخصیص و پیگیری وظایف اعضای تیم',
    permissions: SUPERVISOR,
  },
  {
    code: RoleCode.DEPARTMENT_MANAGER,
    name: 'مدیر دپارتمان',
    description: 'مشاهده و مدیریت تمام وظایف دپارتمان',
    permissions: DEPARTMENT_MANAGER,
  },
  {
    code: RoleCode.HR,
    name: 'کارشناس منابع انسانی',
    description: 'دسترسی به داده‌های عملکردی خام بدون محتوای وظایف',
    permissions: [...EMPLOYEE_BASE, P.PERFORMANCE_VIEW, P.PERFORMANCE_EXPORT],
  },
  {
    code: RoleCode.HR_MANAGER,
    name: 'مدیر منابع انسانی',
    description: 'مدیریت دپارتمان منابع انسانی و دسترسی به داده‌های عملکردی',
    permissions: [...DEPARTMENT_MANAGER, P.PERFORMANCE_VIEW, P.PERFORMANCE_EXPORT],
  },
  {
    code: RoleCode.CEO,
    name: 'مدیرعامل',
    description: 'دید و مدیریت کامل سازمانی',
    permissions: [
      ...DEPARTMENT_MANAGER,
      P.TASK_VIEW_ALL,
      P.TASK_MANAGE_ALL,
      P.REPORT_VIEW_ALL,
      P.PERFORMANCE_VIEW,
      P.PERFORMANCE_EXPORT,
    ],
  },
  {
    code: RoleCode.ADMIN,
    name: 'مدیر سیستم',
    description: 'مدیریت فنی کاربران، ساختار سازمانی، نقش‌ها و تنظیمات',
    permissions: [
      P.TASK_CREATE_SELF,
      P.USER_MANAGE,
      P.DEPARTMENT_MANAGE,
      P.TEAM_MANAGE,
      P.ROLE_MANAGE,
      P.SETTINGS_MANAGE,
      P.INTEGRATION_MANAGE,
      P.AUDIT_VIEW,
      P.PROJECT_MANAGE,
    ],
  },
];

export type TaskScope = 'self' | 'team' | 'department' | 'all';

/** Highest task visibility scope granted by a permission set. */
export function taskViewScope(permissions: readonly string[]): TaskScope {
  if (permissions.includes(P.TASK_VIEW_ALL)) return 'all';
  if (permissions.includes(P.TASK_VIEW_DEPARTMENT)) return 'department';
  if (permissions.includes(P.TASK_VIEW_TEAM)) return 'team';
  return 'self';
}

/** Highest task management scope granted by a permission set. */
export function taskManageScope(permissions: readonly string[]): TaskScope {
  if (permissions.includes(P.TASK_MANAGE_ALL)) return 'all';
  if (permissions.includes(P.TASK_MANAGE_DEPARTMENT)) return 'department';
  if (permissions.includes(P.TASK_MANAGE_TEAM)) return 'team';
  return 'self';
}

/** Highest reporting scope granted by a permission set. */
export function reportScope(permissions: readonly string[]): TaskScope {
  if (permissions.includes(P.REPORT_VIEW_ALL)) return 'all';
  if (permissions.includes(P.REPORT_VIEW_DEPARTMENT)) return 'department';
  if (permissions.includes(P.REPORT_VIEW_TEAM)) return 'team';
  return 'self';
}
