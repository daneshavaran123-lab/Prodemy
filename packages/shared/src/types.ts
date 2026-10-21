/**
 * API contract types (JSON shapes returned by the REST API).
 * Dates are ISO-8601 strings in UTC.
 */
import type {
  AssignmentType,
  AuditAction,
  BlockerStatus,
  BlockerType,
  CommentKind,
  DelayReasonType,
  DeliveryStatus,
  EmploymentStatus,
  NotificationChannel,
  NotificationPriority,
  NotificationType,
  RecordStatus,
  RecurrenceFrequency,
  ReviewStatus,
  RiskLevel,
  TaskEventType,
  TaskPriority,
  TaskStatus,
  UserStatus,
} from './enums';
import type { TaskScope } from './permissions';

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  statusCode: number;
  message: string;
  code?: string;
  details?: unknown;
}

export interface DepartmentRef {
  id: string;
  name: string;
}

export interface EmployeeRef {
  id: string;
  fullName: string;
  jobTitle: string | null;
  departmentId: string;
}

export interface SessionUser {
  userId: string;
  username: string;
  email: string | null;
  mustChangePassword: boolean;
  employee: {
    id: string;
    fullName: string;
    jobTitle: string | null;
    departmentId: string;
    departmentName: string;
    teamId: string | null;
    managerId: string | null;
  };
  role: { id: string; code: string; name: string };
  permissions: string[];
  scopes: { taskView: TaskScope; taskManage: TaskScope; report: TaskScope };
  managesDepartmentIds: string[];
  /** Own department plus managed departments. */
  departmentScopeIds: string[];
  preferences: NotificationPreferences;
  telegramLinked: boolean;
}

export interface NotificationPreferences {
  emailEnabled: boolean;
  telegramEnabled: boolean;
  digestEnabled: boolean;
}

export interface RiskFactor {
  code: string;
  label: string;
  points: number;
}

export interface RiskAssessment {
  level: RiskLevel;
  score: number;
  factors: RiskFactor[];
  assessedAt: string;
}

export interface TaskSummary {
  id: string;
  code: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  progress: number;
  startDate: string;
  deadline: string;
  department: DepartmentRef;
  primaryOwner: EmployeeRef;
  manager: EmployeeRef;
  collaborators: EmployeeRef[];
  tags: string[];
  category: string | null;
  project: { id: string; name: string } | null;
  isOverdue: boolean;
  /** Calendar days late (open & overdue → days so far, completed late → final delay). */
  delayDays: number;
  delayReasonRequired: boolean;
  hasOpenBlocker: boolean;
  risk: RiskAssessment | null;
  reviewStatus: ReviewStatus;
  confidential: boolean;
  subtaskCount: number;
  subtaskDoneCount: number;
  commentCount: number;
  attachmentCount: number;
  recurrenceId: string | null;
  completedAt: string | null;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskPermissions {
  canView: boolean;
  canWork: boolean;
  canEdit: boolean;
  canManage: boolean;
  canComplete: boolean;
  canReview: boolean;
  canReopen: boolean;
  canCancel: boolean;
  canComment: boolean;
}

export interface SubtaskDto {
  id: string;
  title: string;
  owner: EmployeeRef | null;
  deadline: string | null;
  status: TaskStatus;
  progress: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface BlockerDto {
  id: string;
  type: BlockerType;
  description: string;
  blockingEmployee: EmployeeRef | null;
  blockingDepartment: DepartmentRef | null;
  blockingPartyNote: string | null;
  expectedResolutionAt: string | null;
  status: BlockerStatus;
  createdBy: EmployeeRef | null;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface DelayReasonDto {
  id: string;
  reasonType: DelayReasonType;
  description: string | null;
  deadlineAt: string;
  createdBy: EmployeeRef | null;
  createdAt: string;
}

export interface AttachmentDto {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploader: EmployeeRef | null;
  createdAt: string;
}

export interface TaskDetail extends TaskSummary {
  description: string;
  estimatedEffortHours: number | null;
  requiresReview: boolean;
  creator: EmployeeRef;
  version: number;
  overdueAt: string | null;
  cancelledAt: string | null;
  subtasks: SubtaskDto[];
  blockers: BlockerDto[];
  delayReasons: DelayReasonDto[];
  attachments: AttachmentDto[];
  recurrence: RecurrenceSummary | null;
  permissions: TaskPermissions;
}

export interface CommentDto {
  id: string;
  content: string;
  kind: CommentKind;
  author: EmployeeRef | null;
  mentions: EmployeeRef[];
  createdAt: string;
}

export interface TimelineItem {
  id: string;
  type: 'event' | 'comment';
  createdAt: string;
  actor: EmployeeRef | null;
  eventType?: TaskEventType;
  field?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  comment?: CommentDto;
}

export interface RecurrenceSummary {
  id: string;
  frequency: RecurrenceFrequency;
  interval: number;
  weekdays: number[];
  dayOfMonth: number | null;
  active: boolean;
  nextRunAt: string | null;
  endDate: string | null;
}

export interface RecurrenceDto extends RecurrenceSummary {
  title: string;
  description: string;
  priority: TaskPriority;
  durationDays: number;
  primaryOwner: EmployeeRef;
  manager: EmployeeRef;
  department: DepartmentRef;
  startDate: string;
  lastRunAt: string | null;
  instanceCount: number;
  createdAt: string;
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string;
  taskId: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationDeliveryDto {
  id: string;
  channel: NotificationChannel;
  status: DeliveryStatus;
  attempts: number;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
  notification: { id: string; type: NotificationType; title: string; userId: string };
}

export interface DepartmentDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: RecordStatus;
  confidential: boolean;
  manager: EmployeeRef | null;
  headcount: number;
  teamCount: number;
}

export interface TeamDto {
  id: string;
  name: string;
  department: DepartmentRef;
  lead: EmployeeRef | null;
  memberCount: number;
  status: RecordStatus;
}

export interface RoleDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  system: boolean;
  permissions: string[];
  userCount: number;
}

export interface ProjectDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  department: DepartmentRef | null;
  status: RecordStatus;
  taskCount: number;
}

export interface UserAdminDto {
  id: string;
  username: string;
  email: string | null;
  status: UserStatus;
  role: { id: string; code: string; name: string };
  employee: {
    id: string;
    employeeCode: string;
    fullName: string;
    jobTitle: string | null;
    department: DepartmentRef;
    team: { id: string; name: string } | null;
    manager: EmployeeRef | null;
    employmentStatus: EmploymentStatus;
    phone: string | null;
  };
  telegramLinked: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  openTaskCount: number;
}

export interface DirectoryEmployee extends EmployeeRef {
  departmentName: string;
  teamId: string | null;
  managerId: string | null;
  employmentStatus: EmploymentStatus;
  /** True when the current user may make this person a task's primary owner. */
  assignable: boolean;
}

export interface AuditLogDto {
  id: string;
  action: AuditAction;
  actor: { userId: string; username: string; fullName: string | null } | null;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  ip: string | null;
  createdAt: string;
}

export interface SavedViewDto {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  createdAt: string;
}

/* ---------------------------------------------------------------- Dashboards */

export interface KpiSet {
  headcount: number;
  total: number;
  active: number;
  completed: number;
  completedOnTime: number;
  /** Share of completed tasks finished by their deadline (0..1), null when nothing completed. */
  onTimeRate: number | null;
  /** Of the non-cancelled tasks due in the period, the share already completed (0..1). */
  completionRate: number | null;
  overdue: number;
  /** overdue / active (0..1). */
  overdueRate: number | null;
  /** Average delay in days over late tasks (completed late + currently overdue). */
  avgDelayDays: number;
  blocked: number;
  blockedRate: number | null;
  atRisk: number;
  riskRate: number | null;
  /** Active tasks per employee. */
  tasksPerEmployee: number | null;
  pendingReview: number;
}

export type AttentionReason =
  | 'CRITICAL_OVERDUE'
  | 'OVERDUE'
  | 'BLOCKED'
  | 'HIGH_RISK'
  | 'NO_RECENT_UPDATE'
  | 'NEAR_DEADLINE'
  | 'HIGH_PRIORITY'
  | 'PENDING_REVIEW'
  | 'DELAY_REASON_MISSING'
  | 'OWNER_INACTIVE';

export interface NeedsAttentionItem {
  task: TaskSummary;
  reasons: AttentionReason[];
  severity: number;
}

export type WorkloadState = 'OVERLOADED' | 'BALANCED' | 'UNDERUTILIZED';

export interface WorkloadRow {
  employee: EmployeeRef & { departmentName: string };
  active: number;
  overdue: number;
  blocked: number;
  highPriority: number;
  dueThisWeek: number;
  /** Priority-weighted open task load. */
  load: number;
  /** load relative to the comparison group's mean (1 = average). */
  loadIndex: number | null;
  state: WorkloadState;
  onLeave: boolean;
}

export interface TrendPoint {
  periodStart: string;
  created: number;
  completed: number;
  completedOnTime: number;
  overdueOpen: number;
}

export interface ActivityItem {
  id: string;
  task: { id: string; code: string; title: string };
  actor: EmployeeRef | null;
  eventType: TaskEventType;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
}

export interface EmployeeDashboard {
  summary: {
    active: number;
    dueToday: number;
    overdue: number;
    dueSoon: number;
    blocked: number;
    completedThisWeek: number;
    pendingDelayReasons: number;
  };
  today: TaskSummary[];
  overdue: TaskSummary[];
  dueSoon: TaskSummary[];
  highPriority: TaskSummary[];
  blocked: TaskSummary[];
  recentlyCompleted: TaskSummary[];
  delayReasonRequired: TaskSummary[];
  collaborating: TaskSummary[];
}

export interface ManagerDashboard {
  scope: { type: TaskScope; departmentId: string | null; label: string };
  kpis: KpiSet;
  needsAttention: NeedsAttentionItem[];
  active: TaskSummary[];
  overdue: TaskSummary[];
  atRisk: TaskSummary[];
  blocked: TaskSummary[];
  approaching: TaskSummary[];
  pendingReview: TaskSummary[];
  recentlyCompleted: TaskSummary[];
  workload: WorkloadRow[];
  distribution: {
    byStatus: Record<TaskStatus, number>;
    byPriority: Record<TaskPriority, number>;
  };
  recentActivity: ActivityItem[];
}

export interface BlockerHotspot {
  department: DepartmentRef | null;
  employee: EmployeeRef | null;
  label: string;
  openBlockers: number;
  affectedTasks: number;
  avgOpenDays: number;
}

export interface DelayReasonStat {
  reasonType: DelayReasonType;
  count: number;
}

export interface DepartmentDashboard {
  department: DepartmentDto;
  kpis: KpiSet;
  trend: TrendPoint[];
  workload: WorkloadRow[];
  atRisk: TaskSummary[];
  overdue: TaskSummary[];
  blocked: TaskSummary[];
  blockers: BlockerHotspot[];
  delayReasons: DelayReasonStat[];
  teams: Array<{ team: { id: string; name: string }; kpis: KpiSet }>;
}

export interface DepartmentComparisonRow {
  department: DepartmentRef & { confidential: boolean };
  kpis: KpiSet;
}

export interface OrganizationDashboard {
  kpis: KpiSet;
  departments: DepartmentComparisonRow[];
  critical: TaskSummary[];
  overdue: TaskSummary[];
  atRisk: TaskSummary[];
  bottlenecks: BlockerHotspot[];
  delayReasons: DelayReasonStat[];
  trend: TrendPoint[];
  workload: {
    overloaded: WorkloadRow[];
    underutilized: WorkloadRow[];
    departmentLoad: Array<{ department: DepartmentRef; avgLoad: number; headcount: number }>;
  };
}

/* ---------------------------------------------------------------- Reports */

export interface PerformanceMetricRow {
  employee: { id: string; employeeCode: string; fullName: string; jobTitle: string | null };
  department: DepartmentRef;
  period: string;
  totalTasks: number;
  completedTasks: number;
  completedOnTime: number;
  overdueTasks: number;
  completionRate: number | null;
  onTimeRate: number | null;
  avgDelayDays: number;
  activeWorkload: number;
  blockedTasks: number;
  updateRate: number | null;
}

export interface ReportResponse {
  scope: { type: 'employee' | 'team' | 'department' | 'organization'; id: string | null; label: string };
  period: { from: string; to: string };
  kpis: KpiSet;
  trend: TrendPoint[];
  delayReasons: DelayReasonStat[];
  breakdown: Array<{ key: string; label: string; kpis: KpiSet }>;
}

/* ---------------------------------------------------------------- AI */

export interface AiStatus {
  enabled: boolean;
  provider: string;
  model: string | null;
  available: boolean;
}

export interface AiTaskDraft {
  title: string;
  description: string;
  primaryOwner: EmployeeRef | null;
  /** Name the text mentioned when it could not be matched to an assignable employee. */
  unresolvedAssignee: string | null;
  deadline: string | null;
  priority: TaskPriority;
  tags: string[];
  source: 'ai' | 'heuristic';
  confidence: number;
  warnings: string[];
}

export interface AiSummary {
  scope: string;
  generatedAt: string;
  /** Deterministic summary built from metrics — always present. */
  text: string;
  highlights: string[];
  /** LLM narrative; null when AI is disabled or unavailable. */
  aiText: string | null;
  aiAvailable: boolean;
  aiError: string | null;
  stats: Record<string, number>;
}

export interface PrioritySuggestion {
  priority: TaskPriority;
  reasons: string[];
  source: 'ai' | 'heuristic';
}

export interface WorkloadInsight {
  overloaded: WorkloadRow[];
  underutilized: WorkloadRow[];
  unevenDistribution: boolean;
  /** Coefficient of variation of load across the group. */
  dispersion: number;
  notes: string[];
}

/* ---------------------------------------------------------------- Settings */

export interface SystemSettings {
  reminderOffsetsDays: number[];
  workingDays: number[];
  holidays: string[];
  attachmentMaxMb: number;
  registrationRequiresApproval: boolean;
  staleTaskDays: number;
  digestHour: number;
  weeklySummaryDay: number;
  weeklySummaryHour: number;
  overloadThreshold: number;
  underutilizedThreshold: number;
  telegramBotUsername: string | null;
}

export interface IntegrationStatus {
  email: { configured: boolean; host: string | null; from: string | null };
  telegram: { configured: boolean; mode: string; botUsername: string | null };
  ai: AiStatus;
  storage: { driver: string; bucket: string | null };
  queue: { connected: boolean };
}
