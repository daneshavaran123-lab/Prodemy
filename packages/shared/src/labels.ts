import type {
  AuditAction,
  BlockerType,
  CommentKind,
  DelayReasonType,
  EmploymentStatus,
  NotificationType,
  RecurrenceFrequency,
  ReviewStatus,
  RiskLevel,
  TaskEventType,
  TaskPriority,
  TaskStatus,
  UserStatus,
} from './enums';

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  NOT_STARTED: 'شروع نشده',
  IN_PROGRESS: 'در حال انجام',
  WAITING: 'در انتظار',
  BLOCKED: 'مسدود',
  COMPLETED: 'تکمیل شده',
  CANCELLED: 'لغو شده',
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: 'کم',
  NORMAL: 'عادی',
  HIGH: 'بالا',
  URGENT: 'فوری',
};

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  NONE: '—',
  PENDING: 'در انتظار بررسی مدیر',
  ACCEPTED: 'تأیید شده',
};

export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  LOW: 'ریسک کم',
  MEDIUM: 'ریسک متوسط',
  HIGH: 'ریسک بالا',
};

export const DELAY_REASON_LABELS: Record<DelayReasonType, string> = {
  WORKLOAD: 'حجم کاری',
  WAITING_OTHER_DEPARTMENT: 'انتظار برای واحد دیگر',
  INCOMPLETE_INFORMATION: 'اطلاعات ناقص',
  SCOPE_CHANGE: 'تغییر دامنه کار',
  CUSTOMER_DELAY: 'تأخیر مشتری',
  TECHNICAL_ISSUE: 'مشکل فنی',
  LEAVE: 'مرخصی',
  PRIORITY_CHANGE: 'تغییر اولویت',
  OTHER: 'سایر',
};

export const BLOCKER_TYPE_LABELS: Record<BlockerType, string> = {
  WAITING_PERSON: 'انتظار برای یک همکار',
  WAITING_DEPARTMENT: 'انتظار برای واحد دیگر',
  MISSING_INFORMATION: 'نبود اطلاعات لازم',
  TECHNICAL: 'مشکل فنی',
  EXTERNAL: 'عامل بیرونی (مشتری / تأمین‌کننده)',
  RESOURCE: 'کمبود منابع',
  OTHER: 'سایر',
};

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  PENDING: 'در انتظار تأیید',
  ACTIVE: 'فعال',
  DISABLED: 'غیرفعال',
};

export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  ACTIVE: 'مشغول به کار',
  ON_LEAVE: 'در مرخصی',
  TERMINATED: 'قطع همکاری',
};

export const RECURRENCE_LABELS: Record<RecurrenceFrequency, string> = {
  DAILY: 'روزانه',
  WEEKLY: 'هفتگی',
  MONTHLY: 'ماهانه',
  CUSTOM: 'هر چند روز یک‌بار',
};

export const COMMENT_KIND_LABELS: Record<CommentKind, string> = {
  COMMENT: 'نظر',
  DECISION: 'تصمیم',
  BLOCKER_NOTE: 'توضیح مانع',
};

export const TASK_EVENT_LABELS: Record<TaskEventType, string> = {
  CREATED: 'وظیفه ایجاد شد',
  ASSIGNED: 'وظیفه تخصیص یافت',
  REASSIGNED: 'مسئول اصلی تغییر کرد',
  COLLABORATORS_CHANGED: 'همکاران تغییر کردند',
  MANAGER_CHANGED: 'مدیر وظیفه تغییر کرد',
  STATUS_CHANGED: 'وضعیت تغییر کرد',
  PROGRESS_CHANGED: 'پیشرفت به‌روزرسانی شد',
  DEADLINE_CHANGED: 'مهلت تغییر کرد',
  PRIORITY_CHANGED: 'اولویت تغییر کرد',
  DETAILS_CHANGED: 'جزئیات ویرایش شد',
  COMMENT_ADDED: 'نظر ثبت شد',
  ATTACHMENT_ADDED: 'فایل پیوست شد',
  ATTACHMENT_REMOVED: 'فایل حذف شد',
  SUBTASK_ADDED: 'زیروظیفه اضافه شد',
  SUBTASK_UPDATED: 'زیروظیفه به‌روزرسانی شد',
  SUBTASK_REMOVED: 'زیروظیفه حذف شد',
  BLOCKER_ADDED: 'مانع ثبت شد',
  BLOCKER_RESOLVED: 'مانع برطرف شد',
  DELAY_REASON_ADDED: 'دلیل تأخیر ثبت شد',
  MARKED_OVERDUE: 'مهلت گذشت و وظیفه عقب‌افتاده شد',
  COMPLETED: 'وظیفه تکمیل شد',
  ACCEPTED: 'تکمیل وظیفه توسط مدیر تأیید شد',
  REOPENED: 'وظیفه بازگشایی شد',
  CANCELLED: 'وظیفه لغو شد',
};

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  TASK_ASSIGNED: 'تخصیص وظیفه جدید',
  TASK_REASSIGNED: 'تغییر مسئول وظیفه',
  COLLABORATOR_ADDED: 'افزوده شدن به‌عنوان همکار',
  DEADLINE_APPROACHING: 'نزدیک شدن مهلت',
  DEADLINE_REACHED: 'رسیدن مهلت',
  TASK_OVERDUE: 'وظیفه عقب‌افتاده',
  DELAY_REASON_REQUIRED: 'نیاز به ثبت دلیل تأخیر',
  COMMENT_ADDED: 'نظر جدید',
  MENTIONED: 'اشاره به شما',
  TASK_BLOCKED: 'مسدود شدن وظیفه',
  PRIORITY_CHANGED: 'تغییر اولویت',
  DEADLINE_CHANGED: 'تغییر مهلت',
  TASK_COMPLETED: 'تکمیل وظیفه',
  TASK_ACCEPTED: 'تأیید تکمیل وظیفه',
  TASK_REOPENED: 'بازگشایی وظیفه',
  TASK_CANCELLED: 'لغو وظیفه',
  OWNER_DEACTIVATED: 'غیرفعال شدن مسئول وظیفه',
  ACCOUNT_PENDING_APPROVAL: 'حساب کاربری در انتظار تأیید',
  WEEKLY_SUMMARY: 'خلاصه هفتگی',
  DIGEST: 'خلاصه فعالیت‌ها',
  SYSTEM: 'پیام سیستم',
};

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  LOGIN: 'ورود',
  LOGIN_FAILED: 'ورود ناموفق',
  LOGOUT: 'خروج',
  REGISTERED: 'ثبت‌نام',
  PASSWORD_CHANGED: 'تغییر رمز عبور',
  PASSWORD_RESET_REQUESTED: 'درخواست بازیابی رمز',
  PASSWORD_RESET: 'بازیابی رمز عبور',
  USER_CREATED: 'ایجاد کاربر',
  USER_UPDATED: 'ویرایش کاربر',
  USER_APPROVED: 'تأیید حساب کاربری',
  USER_DISABLED: 'غیرفعال‌سازی کاربر',
  USER_ENABLED: 'فعال‌سازی مجدد کاربر',
  ROLE_CHANGED: 'تغییر نقش',
  ROLE_CREATED: 'ایجاد نقش',
  PERMISSION_CHANGED: 'تغییر مجوزها',
  DEPARTMENT_CHANGED: 'تغییر دپارتمان',
  TEAM_CHANGED: 'تغییر تیم',
  SETTINGS_CHANGED: 'تغییر تنظیمات',
  TASK_CHANGED: 'تغییر وظیفه',
  ACCESS_DENIED: 'دسترسی غیرمجاز',
  DATA_EXPORTED: 'خروجی گرفتن از داده',
  INTEGRATION_ERROR: 'خطای یکپارچه‌سازی',
  AI_ERROR: 'خطای هوش مصنوعی',
  NOTIFICATION_FAILURE: 'خطای ارسال اعلان',
};

export const ATTENTION_REASON_LABELS: Record<import('./types').AttentionReason, string> = {
  CRITICAL_OVERDUE: 'تأخیر بحرانی',
  OVERDUE: 'عقب‌افتاده',
  BLOCKED: 'مسدود',
  HIGH_RISK: 'ریسک بالای تأخیر',
  NO_RECENT_UPDATE: 'بدون به‌روزرسانی اخیر',
  NEAR_DEADLINE: 'نزدیک مهلت',
  HIGH_PRIORITY: 'فوری و شروع‌نشده',
  PENDING_REVIEW: 'در انتظار تأیید شما',
  DELAY_REASON_MISSING: 'دلیل تأخیر ثبت نشده',
  OWNER_INACTIVE: 'مسئول غیرفعال — نیاز به تخصیص مجدد',
};

export const WORKLOAD_STATE_LABELS: Record<import('./types').WorkloadState, string> = {
  OVERLOADED: 'بار کاری بالا',
  BALANCED: 'متعادل',
  UNDERUTILIZED: 'ظرفیت آزاد',
};

export const WEEKDAY_LABELS: Record<number, string> = {
  6: 'شنبه',
  0: 'یکشنبه',
  1: 'دوشنبه',
  2: 'سه‌شنبه',
  3: 'چهارشنبه',
  4: 'پنجشنبه',
  5: 'جمعه',
};

/** Saturday-first order used by Iranian calendars. */
export const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5];
