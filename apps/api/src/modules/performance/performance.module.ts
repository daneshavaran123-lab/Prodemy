import { Controller, Get, HttpCode, Module, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import type { Response } from 'express';
import { Permission } from '@karban/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { sendFile } from '../reports/reports.module';
import { PerformanceService } from './performance.service';

class PerformanceQuery {
  /** Jalali month, e.g. 1405-07. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  period?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

class PerformanceExportQuery extends PerformanceQuery {
  @IsOptional()
  @IsIn(['csv', 'xlsx'])
  format?: 'csv' | 'xlsx';
}

class RecordsQuery {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  period?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;
}

@ApiTags('performance')
@Controller('performance')
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  @Get('metrics')
  @RequirePermissions(Permission.PERFORMANCE_VIEW)
  metrics(@Query() q: PerformanceQuery) {
    return this.performance.metrics(q.period, q.departmentId);
  }

  @Get('export')
  @RequirePermissions(Permission.PERFORMANCE_EXPORT)
  async export(@CurrentUser() ctx: AuthContext, @Query() q: PerformanceExportQuery, @Res() res: Response) {
    sendFile(res, await this.performance.export(ctx, q.period, q.departmentId, q.format ?? 'xlsx'));
  }

  /** Integration endpoint for a future Performance Management system (tech stack §16). */
  @Get('records')
  @RequirePermissions(Permission.PERFORMANCE_EXPORT)
  records(@Query() q: RecordsQuery) {
    return this.performance.records(q.period, q.employeeId);
  }

  @Post('snapshots')
  @HttpCode(200)
  @RequirePermissions(Permission.PERFORMANCE_EXPORT)
  snapshot(@Query() q: PerformanceQuery) {
    return this.performance.snapshot(q.period);
  }
}

@Module({
  controllers: [PerformanceController],
  providers: [PerformanceService],
  exports: [PerformanceService],
})
export class PerformanceModule {}
