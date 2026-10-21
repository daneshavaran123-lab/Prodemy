import { RecordStatus } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ToBoolean, Trim } from '../../common/dto';

export class CreateDepartmentDto {
  @Trim()
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_-]{1,15}$/, { message: 'کد دپارتمان باید لاتین و با حروف بزرگ باشد (مثلاً FIN)' })
  code: string;

  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  confidential?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  managerId?: string | null;
}

export class UpdateDepartmentDto {
  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  confidential?: boolean;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  managerId?: string | null;
}

export class CreateTeamDto {
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsUUID()
  departmentId: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  leadId?: string | null;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  memberIds?: string[];
}

export class UpdateTeamDto {
  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  leadId?: string | null;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  memberIds?: string[];
}

export class DirectoryQuery {
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @Trim()
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  assignableOnly?: boolean;
}
