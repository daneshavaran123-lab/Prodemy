import { Controller, Get, Module, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { Permission } from '@karban/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { OrgModule } from '../org/org.module';
import { DashboardService } from './dashboard.service';

class ManagerQuery {
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('employee')
  employee(@CurrentUser() ctx: AuthContext) {
    return this.dashboard.employee(ctx);
  }

  @Get('manager')
  manager(@CurrentUser() ctx: AuthContext, @Query() q: ManagerQuery) {
    return this.dashboard.manager(ctx, q.departmentId);
  }

  @Get('department/:id')
  department(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.dashboard.department(ctx, id);
  }

  @Get('organization')
  @RequirePermissions(Permission.REPORT_VIEW_ALL)
  organization(@CurrentUser() ctx: AuthContext) {
    return this.dashboard.organization(ctx);
  }
}

@Module({
  imports: [OrgModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
