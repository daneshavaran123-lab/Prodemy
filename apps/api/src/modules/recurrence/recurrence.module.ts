import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TaskPriority } from '@prisma/client';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { CurrentUser } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { Trim } from '../../common/dto';
import { RecurrenceService } from './recurrence.service';

class UpdateRecurrenceDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string | null;

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
  @IsEnum(TaskPriority)
  priority?: TaskPriority;
}

@ApiTags('recurrence')
@Controller('recurrences')
export class RecurrenceController {
  constructor(private readonly recurrence: RecurrenceService) {}

  @Get()
  list(@CurrentUser() ctx: AuthContext) {
    return this.recurrence.list(ctx);
  }

  @Patch(':id')
  update(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRecurrenceDto) {
    return this.recurrence.update(ctx, id, dto);
  }
}

@Module({
  controllers: [RecurrenceController],
  providers: [RecurrenceService],
  exports: [RecurrenceService],
})
export class RecurrenceModule {}
