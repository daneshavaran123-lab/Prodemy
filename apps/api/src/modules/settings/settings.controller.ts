import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Permission } from '@karban/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { SettingsService } from './settings.service';

class UpdateSettingsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(-30, { each: true })
  @Max(30, { each: true })
  reminderOffsetsDays?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  workingDays?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { each: true, message: 'تاریخ تعطیلی باید به شکل YYYY-MM-DD باشد' })
  holidays?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  attachmentMaxMb?: number;

  @IsOptional()
  @IsBoolean()
  registrationRequiresApproval?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  staleTaskDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  digestHour?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  weeklySummaryDay?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  weeklySummaryHour?: number;

  @IsOptional()
  @IsNumber()
  @Min(1.1)
  @Max(5)
  overloadThreshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(0.9)
  underutilizedThreshold?: number;

  @IsOptional()
  @IsString()
  telegramBotUsername?: string | null;
}

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Readable by every signed-in user (UI needs limits such as attachment size). */
  @Get()
  get() {
    return this.settings.get();
  }

  @Patch()
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  update(@CurrentUser() ctx: AuthContext, @Body() dto: UpdateSettingsDto) {
    return this.settings.update(ctx, dto);
  }
}
