import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { Permission } from '@karban/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { ToBoolean } from '../../common/dto';
import { OrgService } from './org.service';
import { CreateDepartmentDto, CreateTeamDto, DirectoryQuery, UpdateDepartmentDto, UpdateTeamDto } from './org.dto';

class DepartmentsQuery {
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  includeInactive?: boolean;
}

class TeamsQuery {
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

@ApiTags('organization')
@Controller()
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @Get('departments')
  departments(@Query() q: DepartmentsQuery) {
    return this.org.listDepartments(q.includeInactive);
  }

  @Get('departments/:id')
  department(@Param('id', ParseUUIDPipe) id: string) {
    return this.org.getDepartment(id);
  }

  @Post('departments')
  @RequirePermissions(Permission.DEPARTMENT_MANAGE)
  createDepartment(@CurrentUser() ctx: AuthContext, @Body() dto: CreateDepartmentDto) {
    return this.org.createDepartment(ctx, dto);
  }

  @Patch('departments/:id')
  @RequirePermissions(Permission.DEPARTMENT_MANAGE)
  updateDepartment(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.org.updateDepartment(ctx, id, dto);
  }

  @Get('teams')
  teams(@Query() q: TeamsQuery) {
    return this.org.listTeams(q.departmentId);
  }

  @Post('teams')
  @RequirePermissions(Permission.TEAM_MANAGE)
  createTeam(@CurrentUser() ctx: AuthContext, @Body() dto: CreateTeamDto) {
    return this.org.createTeam(ctx, dto);
  }

  @Patch('teams/:id')
  @RequirePermissions(Permission.TEAM_MANAGE)
  updateTeam(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTeamDto) {
    return this.org.updateTeam(ctx, id, dto);
  }

  @Get('employees/directory')
  directory(@CurrentUser() ctx: AuthContext, @Query() q: DirectoryQuery) {
    return this.org.directory(ctx, q);
  }
}
