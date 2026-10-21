import { Body, Controller, Get, Global, HttpCode, Module, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Permission } from '@karban/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { Trim } from '../../common/dto';
import { OrgModule } from '../org/org.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { AiService } from './ai.service';
import { AiFeaturesService } from './ai-features.service';

class ParseTaskDto {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'متن وظیفه را وارد کنید' })
  @MaxLength(2000)
  text: string;
}

class SuggestPriorityDto {
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  deadline?: Date;

  @IsOptional()
  @IsUUID()
  primaryOwnerId?: string;
}

class DepartmentQuery {
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

class ExecutiveQuery {
  @IsOptional()
  @IsIn(['week', 'month'])
  period?: 'week' | 'month';
}

const AI_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

@ApiTags('ai')
@Controller('ai')
@RequirePermissions(Permission.AI_USE)
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly features: AiFeaturesService,
  ) {}

  @Get('status')
  status() {
    return this.ai.status();
  }

  /** Returns a draft only — the task is created after the user confirms it (PRD §115). */
  @Post('parse-task')
  @HttpCode(200)
  @Throttle(AI_THROTTLE)
  parse(@CurrentUser() ctx: AuthContext, @Body() dto: ParseTaskDto) {
    return this.features.parseTask(ctx, dto.text);
  }

  @Post('suggest-priority')
  @HttpCode(200)
  @Throttle(AI_THROTTLE)
  suggestPriority(@CurrentUser() ctx: AuthContext, @Body() dto: SuggestPriorityDto) {
    return this.features.suggestPriority(ctx, dto);
  }

  @Get('summary/daily')
  daily(@CurrentUser() ctx: AuthContext) {
    return this.features.dailySummary(ctx);
  }

  @Get('summary/manager')
  manager(@CurrentUser() ctx: AuthContext, @Query() q: DepartmentQuery) {
    return this.features.managerSummary(ctx, q.departmentId);
  }

  @Get('summary/executive')
  executive(@CurrentUser() ctx: AuthContext, @Query() q: ExecutiveQuery) {
    return this.features.executiveSummary(ctx, q.period ?? 'week');
  }

  @Get('workload')
  workload(@CurrentUser() ctx: AuthContext, @Query() q: DepartmentQuery) {
    return this.features.workloadInsight(ctx, q.departmentId);
  }
}

@Global()
@Module({
  imports: [OrgModule, DashboardModule],
  controllers: [AiController],
  providers: [AiService, AiFeaturesService],
  exports: [AiService, AiFeaturesService],
})
export class AiModule {}
