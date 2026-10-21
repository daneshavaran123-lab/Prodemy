import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { Trim } from '../../common/dto';

const lower = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));

export class LoginDto {
  @lower()
  @IsString()
  @IsNotEmpty({ message: 'نام کاربری را وارد کنید' })
  @MaxLength(64)
  username: string;

  @IsString()
  @IsNotEmpty({ message: 'رمز عبور را وارد کنید' })
  @MaxLength(128)
  password: string;
}

export class RegisterDto {
  @lower()
  @IsString()
  @Matches(/^[a-z][a-z0-9._-]{2,31}$/, {
    message: 'نام کاربری باید ۳ تا ۳۲ کاراکتر لاتین باشد و با حرف شروع شود',
  })
  username: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'نام و نام خانوادگی را وارد کنید' })
  @MaxLength(120)
  fullName: string;

  @lower()
  @IsOptional()
  @IsEmail({}, { message: 'ایمیل معتبر نیست' })
  email?: string;

  @IsUUID('all', { message: 'دپارتمان را انتخاب کنید' })
  departmentId: string;

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

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  employeeCode?: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}

export class ForgotPasswordDto {
  @lower()
  @IsString()
  @IsNotEmpty({ message: 'نام کاربری یا ایمیل را وارد کنید' })
  @MaxLength(254)
  identifier: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}
