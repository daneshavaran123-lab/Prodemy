import { EmploymentStatus, UserStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQuery, ToBoolean, Trim } from '../../common/dto';

const lower = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() || undefined : value));

export class ListUsersQuery extends PaginationQuery {
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  roleId?: string;

  @Trim()
  @IsOptional()
  @IsString()
  q?: string;
}

export class CreateUserDto {
  @lower()
  @IsString()
  @Matches(/^[a-z][a-z0-9._-]{2,31}$/, {
    message: 'نام کاربری باید ۳ تا ۳۲ کاراکتر لاتین باشد و با حرف شروع شود',
  })
  username: string;

  /** Optional; a random temporary password is generated (and returned once) when omitted. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @lower()
  @IsOptional()
  @IsEmail()
  email?: string;

  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  employeeCode?: string;

  @IsUUID()
  departmentId: string;

  @IsOptional()
  @IsUUID()
  teamId?: string;

  @IsOptional()
  @IsUUID()
  managerId?: string;

  @IsUUID()
  roleId: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;
}

export class UpdateUserDto {
  @lower()
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEmail()
  email?: string | null;

  @Trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  employeeCode?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  teamId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  managerId?: string | null;

  @IsOptional()
  @IsUUID()
  roleId?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsEnum(EmploymentStatus)
  employmentStatus?: EmploymentStatus;
}

export class DisableUserDto {
  /** Also mark the employee as having left the organization (PRD §86). */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  terminated?: boolean;
}
