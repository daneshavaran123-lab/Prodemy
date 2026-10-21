import { Controller, Get, Module, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsOptional, IsUUID } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { DashboardModule } from '../dashboard/dashboard.module';
import { TasksModule } from '../tasks/tasks.module';
import { ListTasksQuery } from '../tasks/tasks.dto';
import { ReportsService, type ExportFormat, type ReportScope } from './reports.service';

class ReportQuery {
  @IsIn(['employee', 'team', 'department', 'organization'])
  scope: ReportScope;

  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

class ReportExportQuery extends ReportQuery {
  @IsOptional()
  @IsIn(['csv', 'xlsx'])
  format?: ExportFormat;
}

class TaskExportQuery extends ListTasksQuery {
  @IsOptional()
  @IsIn(['csv', 'xlsx'])
  format?: ExportFormat;
}

export function sendFile(res: Response, file: { buffer: Buffer; fileName: string; mimeType: string }) {
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(file.buffer);
}

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  summary(@CurrentUser() ctx: AuthContext, @Query() q: ReportQuery) {
    return this.reports.summary(ctx, q.scope, q.id, this.reports.resolvePeriod(q.from, q.to));
  }

  @Get('export/summary')
  async exportSummary(@CurrentUser() ctx: AuthContext, @Query() q: ReportExportQuery, @Res() res: Response) {
    const file = await this.reports.exportSummary(
      ctx,
      q.scope,
      q.id,
      this.reports.resolvePeriod(q.from, q.to),
      q.format ?? 'xlsx',
    );
    sendFile(res, file);
  }

  @Get('export/tasks')
  async exportTasks(@CurrentUser() ctx: AuthContext, @Query() q: TaskExportQuery, @Res() res: Response) {
    const { format, ...filters } = q;
    const file = await this.reports.exportTasks(ctx, filters as ListTasksQuery, format ?? 'xlsx');
    sendFile(res, file);
  }
}

@Module({
  imports: [DashboardModule, TasksModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
