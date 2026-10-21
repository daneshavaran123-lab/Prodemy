import {
  BlockerType,
  CommentKind,
  DelayReasonType,
  RecurrenceFrequency,
  RiskLevel,
  TaskPriority,
  TaskStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery, ToArray, ToBoolean, Trim } from '../../common/dto';

export class RecurrenceInputDto {
  @IsEnum(RecurrenceFrequency)
  frequency: RecurrenceFrequency;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  interval?: number;

  /** Weekly: 0=Sunday … 6=Saturday. */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];

  /** Monthly: day of the Jalali month. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(29)
  dayOfMonth?: number;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string;
}

export class CreateTaskDto {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'عنوان وظیفه الزامی است' })
  @MaxLength(200)
  title: string;

  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'شرح وظیفه الزامی است' })
  @MaxLength(10000)
  description: string;

  @IsUUID('all', { message: 'مسئول اصلی را انتخاب کنید' })
  primaryOwnerId: string;

  @IsOptional()
  @IsUUID()
  managerId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;

  /** Mandatory (PRD §20, acceptance §113). */
  @Type(() => Date)
  @IsDate({ message: 'مهلت انجام (Deadline) الزامی است' })
  deadline: Date;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsIn([TaskStatus.NOT_STARTED, TaskStatus.IN_PROGRESS, TaskStatus.WAITING])
  status?: TaskStatus;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  collaboratorIds?: string[];

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  estimatedEffortHours?: number;

  @IsOptional()
  @IsBoolean()
  confidential?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresReview?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => RecurrenceInputDto)
  recurrence?: RecurrenceInputDto;
}

export class UpdateTaskDto {
  /** Optimistic lock (PRD §91). */
  @IsInt()
  version: number;

  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  description?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  deadline?: Date;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsUUID()
  managerId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(80)
  category?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  projectId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(0)
  @Max(10000)
  estimatedEffortHours?: number | null;

  @IsOptional()
  @IsBoolean()
  confidential?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresReview?: boolean;

  /** Optional explanation recorded with deadline changes. */
  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  changeNote?: string;
}

export class BlockerInputDto {
  @IsEnum(BlockerType)
  type: BlockerType;

  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'توضیح مانع الزامی است' })
  @MaxLength(2000)
  description: string;

  @IsOptional()
  @IsUUID()
  blockingEmployeeId?: string;

  @IsOptional()
  @IsUUID()
  blockingDepartmentId?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  blockingPartyNote?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expectedResolutionAt?: Date;
}

export class ChangeStatusDto {
  @IsIn([TaskStatus.NOT_STARTED, TaskStatus.IN_PROGRESS, TaskStatus.WAITING, TaskStatus.BLOCKED])
  status: TaskStatus;

  @IsOptional()
  @IsInt()
  version?: number;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BlockerInputDto)
  blocker?: BlockerInputDto;
}

export class ProgressDto {
  @IsInt()
  @Min(0)
  @Max(100)
  progress: number;

  @IsOptional()
  @IsInt()
  version?: number;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class DelayReasonInputDto {
  @IsEnum(DelayReasonType)
  reasonType: DelayReasonType;

  @Trim()
  @ValidateIf((o) => o.reasonType === DelayReasonType.OTHER || o.description !== undefined)
  @IsString()
  @IsNotEmpty({ message: 'برای دلیل «سایر» توضیح الزامی است' })
  @MaxLength(2000)
  description?: string;
}

export class CompleteTaskDto {
  @IsOptional()
  @IsInt()
  version?: number;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  /** Required when completing after the deadline without a recorded reason (PRD §28). */
  @IsOptional()
  @ValidateNested()
  @Type(() => DelayReasonInputDto)
  delayReason?: DelayReasonInputDto;
}

export class ReasonDto {
  @IsOptional()
  @IsInt()
  version?: number;

  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'ذکر دلیل الزامی است' })
  @MaxLength(2000)
  reason: string;
}

export class ReopenDto extends ReasonDto {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  deadline?: Date;
}

export class ReassignDto {
  @IsUUID()
  primaryOwnerId: string;

  @IsOptional()
  @IsInt()
  version?: number;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @IsOptional()
  @IsBoolean()
  keepPreviousAsCollaborator?: boolean;
}

export class CollaboratorsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  employeeIds: string[];
}

export class BulkManagerDto {
  @IsUUID()
  fromManagerId: string;

  @IsUUID()
  toManagerId: string;
}

export class CommentInputDto {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'متن نظر خالی است' })
  @MaxLength(5000)
  content: string;

  @IsOptional()
  @IsEnum(CommentKind)
  kind?: CommentKind;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  mentionIds?: string[];
}

export class CreateSubtaskDto {
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  deadline?: Date;
}

export class UpdateSubtaskDto {
  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  ownerId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Date)
  @IsDate()
  deadline?: Date | null;

  @IsOptional()
  @IsIn([TaskStatus.NOT_STARTED, TaskStatus.IN_PROGRESS, TaskStatus.WAITING, TaskStatus.BLOCKED, TaskStatus.COMPLETED])
  status?: TaskStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class ResolveBlockerDto {
  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolutionNote?: string;
}

export const TASK_SORT_FIELDS = [
  'deadline',
  'priority',
  'updatedAt',
  'createdAt',
  'progress',
  'risk',
  'number',
] as const;

export class ListTasksQuery extends PaginationQuery {
  /** mine = owner or collaborator; owned = primary owner; managed = I am task manager. */
  @IsOptional()
  @IsIn(['visible', 'mine', 'owned', 'collaborating', 'managed', 'created'])
  scope?: 'visible' | 'mine' | 'owned' | 'collaborating' | 'managed' | 'created';

  /** Comma list of statuses, or the shortcuts `open` / `closed`. */
  @IsOptional()
  @ToArray()
  @IsArray()
  status?: string[];

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsEnum(TaskPriority, { each: true })
  priority?: TaskPriority[];

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsEnum(RiskLevel, { each: true })
  risk?: RiskLevel[];

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @IsUUID()
  creatorId?: string;

  @IsOptional()
  @IsUUID()
  managerId?: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsUUID()
  teamId?: string;

  @Trim()
  @IsOptional()
  @IsString()
  tag?: string;

  @Trim()
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  overdue?: boolean;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  blocked?: boolean;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  pendingReview?: boolean;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  delayReasonMissing?: boolean;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  deadlineFrom?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  deadlineTo?: Date;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  dueWithinDays?: number;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsIn(TASK_SORT_FIELDS)
  sort?: (typeof TASK_SORT_FIELDS)[number];

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}
