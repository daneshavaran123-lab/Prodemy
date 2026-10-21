/**
 * Domain enums shared by the API and the web app.
 * Values must stay identical to the Prisma enums in apps/api/prisma/schema.prisma.
 */

export const TaskStatus = {
  NOT_STARTED: 'NOT_STARTED',
  IN_PROGRESS: 'IN_PROGRESS',
  WAITING: 'WAITING',
  BLOCKED: 'BLOCKED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

/** Statuses in which a task is still "open" (work remains). */
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = [
  TaskStatus.NOT_STARTED,
  TaskStatus.IN_PROGRESS,
  TaskStatus.WAITING,
  TaskStatus.BLOCKED,
];

/** Statuses an owner can move a task into directly (completion/cancel have their own actions). */
export const WORKING_TASK_STATUSES: readonly TaskStatus[] = OPEN_TASK_STATUSES;

export const TaskPriority = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const;
export type TaskPriority = (typeof TaskPriority)[keyof typeof TaskPriority];

export const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  LOW: 1,
  NORMAL: 2,
  HIGH: 3,
  URGENT: 4,
};

export const ReviewStatus = {
  NONE: 'NONE',
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
} as const;
export type ReviewStatus = (typeof ReviewStatus)[keyof typeof ReviewStatus];

export const AssignmentType = {
  PRIMARY: 'PRIMARY',
  COLLABORATOR: 'COLLABORATOR',
} as const;
export type AssignmentType = (typeof AssignmentType)[keyof typeof AssignmentType];

export const DelayReasonType = {
  WORKLOAD: 'WORKLOAD',
  WAITING_OTHER_DEPARTMENT: 'WAITING_OTHER_DEPARTMENT',
  INCOMPLETE_INFORMATION: 'INCOMPLETE_INFORMATION',
  SCOPE_CHANGE: 'SCOPE_CHANGE',
  CUSTOMER_DELAY: 'CUSTOMER_DELAY',
  TECHNICAL_ISSUE: 'TECHNICAL_ISSUE',
  LEAVE: 'LEAVE',
  PRIORITY_CHANGE: 'PRIORITY_CHANGE',
  OTHER: 'OTHER',
} as const;
export type DelayReasonType = (typeof DelayReasonType)[keyof typeof DelayReasonType];

export const BlockerType = {
  WAITING_PERSON: 'WAITING_PERSON',
  WAITING_DEPARTMENT: 'WAITING_DEPARTMENT',
  MISSING_INFORMATION: 'MISSING_INFORMATION',
  TECHNICAL: 'TECHNICAL',
  EXTERNAL: 'EXTERNAL',
  RESOURCE: 'RESOURCE',
  OTHER: 'OTHER',
} as const;
export type BlockerType = (typeof BlockerType)[keyof typeof BlockerType];

export const BlockerStatus = {
  OPEN: 'OPEN',
  RESOLVED: 'RESOLVED',
} as const;
export type BlockerStatus = (typeof BlockerStatus)[keyof typeof BlockerStatus];

export const RiskLevel = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
} as const;
export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

export const UserStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const EmploymentStatus = {
  ACTIVE: 'ACTIVE',
  ON_LEAVE: 'ON_LEAVE',
  TERMINATED: 'TERMINATED',
} as const;
export type EmploymentStatus = (typeof EmploymentStatus)[keyof typeof EmploymentStatus];

export const RecordStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;
export type RecordStatus = (typeof RecordStatus)[keyof typeof RecordStatus];

export const RecurrenceFrequency = {
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  CUSTOM: 'CUSTOM',
} as const;
export type RecurrenceFrequency = (typeof RecurrenceFrequency)[keyof typeof RecurrenceFrequency];

export const CommentKind = {
  COMMENT: 'COMMENT',
  DECISION: 'DECISION',
  BLOCKER_NOTE: 'BLOCKER_NOTE',
} as const;
export type CommentKind = (typeof CommentKind)[keyof typeof CommentKind];

export const TaskEventType = {
  CREATED: 'CREATED',
  ASSIGNED: 'ASSIGNED',
  REASSIGNED: 'REASSIGNED',
  COLLABORATORS_CHANGED: 'COLLABORATORS_CHANGED',
  MANAGER_CHANGED: 'MANAGER_CHANGED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  PROGRESS_CHANGED: 'PROGRESS_CHANGED',
  DEADLINE_CHANGED: 'DEADLINE_CHANGED',
  PRIORITY_CHANGED: 'PRIORITY_CHANGED',
  DETAILS_CHANGED: 'DETAILS_CHANGED',
  COMMENT_ADDED: 'COMMENT_ADDED',
  ATTACHMENT_ADDED: 'ATTACHMENT_ADDED',
  ATTACHMENT_REMOVED: 'ATTACHMENT_REMOVED',
  SUBTASK_ADDED: 'SUBTASK_ADDED',
  SUBTASK_UPDATED: 'SUBTASK_UPDATED',
  SUBTASK_REMOVED: 'SUBTASK_REMOVED',
  BLOCKER_ADDED: 'BLOCKER_ADDED',
  BLOCKER_RESOLVED: 'BLOCKER_RESOLVED',
  DELAY_REASON_ADDED: 'DELAY_REASON_ADDED',
  MARKED_OVERDUE: 'MARKED_OVERDUE',
  COMPLETED: 'COMPLETED',
  ACCEPTED: 'ACCEPTED',
  REOPENED: 'REOPENED',
  CANCELLED: 'CANCELLED',
} as const;
export type TaskEventType = (typeof TaskEventType)[keyof typeof TaskEventType];

export const NotificationType = {
  TASK_ASSIGNED: 'TASK_ASSIGNED',
  TASK_REASSIGNED: 'TASK_REASSIGNED',
  COLLABORATOR_ADDED: 'COLLABORATOR_ADDED',
  DEADLINE_APPROACHING: 'DEADLINE_APPROACHING',
  DEADLINE_REACHED: 'DEADLINE_REACHED',
  TASK_OVERDUE: 'TASK_OVERDUE',
  DELAY_REASON_REQUIRED: 'DELAY_REASON_REQUIRED',
  COMMENT_ADDED: 'COMMENT_ADDED',
  MENTIONED: 'MENTIONED',
  TASK_BLOCKED: 'TASK_BLOCKED',
  PRIORITY_CHANGED: 'PRIORITY_CHANGED',
  DEADLINE_CHANGED: 'DEADLINE_CHANGED',
  TASK_COMPLETED: 'TASK_COMPLETED',
  TASK_ACCEPTED: 'TASK_ACCEPTED',
  TASK_REOPENED: 'TASK_REOPENED',
  TASK_CANCELLED: 'TASK_CANCELLED',
  OWNER_DEACTIVATED: 'OWNER_DEACTIVATED',
  ACCOUNT_PENDING_APPROVAL: 'ACCOUNT_PENDING_APPROVAL',
  WEEKLY_SUMMARY: 'WEEKLY_SUMMARY',
  DIGEST: 'DIGEST',
  SYSTEM: 'SYSTEM',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

/**
 * Delivery urgency. CRITICAL/NORMAL go out immediately on every enabled channel;
 * LOW stays in-app immediately and is batched into the email digest (PRD §47).
 */
export const NotificationPriority = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  CRITICAL: 'CRITICAL',
} as const;
export type NotificationPriority = (typeof NotificationPriority)[keyof typeof NotificationPriority];

export const NotificationChannel = {
  IN_APP: 'IN_APP',
  EMAIL: 'EMAIL',
  TELEGRAM: 'TELEGRAM',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const DeliveryStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
  DIGESTED: 'DIGESTED',
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

export const AuditAction = {
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  REGISTERED: 'REGISTERED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET: 'PASSWORD_RESET',
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_APPROVED: 'USER_APPROVED',
  USER_DISABLED: 'USER_DISABLED',
  USER_ENABLED: 'USER_ENABLED',
  ROLE_CHANGED: 'ROLE_CHANGED',
  ROLE_CREATED: 'ROLE_CREATED',
  PERMISSION_CHANGED: 'PERMISSION_CHANGED',
  DEPARTMENT_CHANGED: 'DEPARTMENT_CHANGED',
  TEAM_CHANGED: 'TEAM_CHANGED',
  SETTINGS_CHANGED: 'SETTINGS_CHANGED',
  TASK_CHANGED: 'TASK_CHANGED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  DATA_EXPORTED: 'DATA_EXPORTED',
  INTEGRATION_ERROR: 'INTEGRATION_ERROR',
  AI_ERROR: 'AI_ERROR',
  NOTIFICATION_FAILURE: 'NOTIFICATION_FAILURE',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];
