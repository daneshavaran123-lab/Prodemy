import { Injectable } from '@nestjs/common';
import { AuditAction, EmploymentStatus, RecordStatus, UserStatus } from '@prisma/client';
import type { DepartmentDto, DirectoryEmployee, TeamDto } from '@karban/shared';
import { normalizePersian } from '@karban/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../../common/auth-context';
import { Errors } from '../../common/errors';
import { employeeRefSelect, toEmployeeRef } from '../../common/serializers';
import { TaskPolicy } from '../access/access-policy';
import type { CreateDepartmentDto, CreateTeamDto, DirectoryQuery, UpdateDepartmentDto, UpdateTeamDto } from './org.dto';

/** Departments and teams are data, never hard-coded (PRD §16). */
@Injectable()
export class OrgService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------------------------------------ departments */

  async listDepartments(includeInactive = false): Promise<DepartmentDto[]> {
    const rows = await this.prisma.department.findMany({
      where: includeInactive ? undefined : { status: RecordStatus.ACTIVE },
      orderBy: { name: 'asc' },
      include: {
        manager: { select: employeeRefSelect },
        _count: {
          select: {
            employees: { where: { employmentStatus: { not: EmploymentStatus.TERMINATED } } },
            teams: { where: { status: RecordStatus.ACTIVE } },
          },
        },
      },
    });
    return rows.map((d) => this.toDepartmentDto(d));
  }

  async getDepartment(id: string): Promise<DepartmentDto> {
    const d = await this.prisma.department.findUnique({
      where: { id },
      include: {
        manager: { select: employeeRefSelect },
        _count: {
          select: {
            employees: { where: { employmentStatus: { not: EmploymentStatus.TERMINATED } } },
            teams: { where: { status: RecordStatus.ACTIVE } },
          },
        },
      },
    });
    if (!d) throw Errors.notFound('دپارتمان');
    return this.toDepartmentDto(d);
  }

  private toDepartmentDto(d: any): DepartmentDto {
    return {
      id: d.id,
      code: d.code,
      name: d.name,
      description: d.description,
      status: d.status,
      confidential: d.confidential,
      manager: toEmployeeRef(d.manager),
      headcount: d._count.employees,
      teamCount: d._count.teams,
    };
  }

  async createDepartment(ctx: AuthContext, dto: CreateDepartmentDto): Promise<DepartmentDto> {
    if (dto.managerId) await this.assertEmployee(dto.managerId);
    const d = await this.prisma.department.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        confidential: dto.confidential ?? false,
        managerId: dto.managerId ?? null,
      },
    });
    await this.audit.logFor(ctx, {
      action: AuditAction.DEPARTMENT_CHANGED,
      entityType: 'Department',
      entityId: d.id,
      metadata: { op: 'create', ...dto },
    });
    return this.getDepartment(d.id);
  }

  async updateDepartment(ctx: AuthContext, id: string, dto: UpdateDepartmentDto): Promise<DepartmentDto> {
    const before = await this.prisma.department.findUnique({ where: { id } });
    if (!before) throw Errors.notFound('دپارتمان');
    if (dto.managerId) await this.assertEmployee(dto.managerId);
    if (dto.status === RecordStatus.INACTIVE) {
      const active = await this.prisma.employee.count({
        where: {
          departmentId: id,
          employmentStatus: { not: EmploymentStatus.TERMINATED },
          user: { status: UserStatus.ACTIVE },
        },
      });
      if (active > 0) {
        throw Errors.validation('ابتدا کارکنان فعال این دپارتمان را به دپارتمان دیگری منتقل کنید.');
      }
    }
    await this.prisma.department.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        confidential: dto.confidential,
        status: dto.status,
        managerId: dto.managerId,
      },
    });
    await this.audit.logFor(ctx, {
      action: AuditAction.DEPARTMENT_CHANGED,
      entityType: 'Department',
      entityId: id,
      metadata: {
        op: 'update',
        before: {
          name: before.name,
          managerId: before.managerId,
          status: before.status,
          confidential: before.confidential,
        },
        after: dto,
      },
    });
    return this.getDepartment(id);
  }

  /* ------------------------------------------------------------ teams */

  async listTeams(departmentId?: string): Promise<TeamDto[]> {
    const rows = await this.prisma.team.findMany({
      where: { departmentId },
      orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }],
      include: {
        department: { select: { id: true, name: true } },
        lead: { select: employeeRefSelect },
        _count: { select: { members: true } },
      },
    });
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      department: t.department,
      lead: toEmployeeRef(t.lead),
      memberCount: t._count.members,
      status: t.status,
    }));
  }

  async createTeam(ctx: AuthContext, dto: CreateTeamDto): Promise<TeamDto> {
    const dept = await this.prisma.department.findUnique({ where: { id: dto.departmentId } });
    if (!dept) throw Errors.notFound('دپارتمان');
    if (dto.leadId) await this.assertEmployee(dto.leadId);
    const team = await this.prisma.$transaction(async (tx) => {
      const t = await tx.team.create({
        data: { name: dto.name, departmentId: dto.departmentId, leadId: dto.leadId ?? null },
      });
      if (dto.memberIds?.length) {
        await tx.employee.updateMany({ where: { id: { in: dto.memberIds } }, data: { teamId: t.id } });
      }
      return t;
    });
    await this.audit.logFor(ctx, {
      action: AuditAction.TEAM_CHANGED,
      entityType: 'Team',
      entityId: team.id,
      metadata: { op: 'create', ...dto },
    });
    return (await this.listTeams(dto.departmentId)).find((t) => t.id === team.id)!;
  }

  async updateTeam(ctx: AuthContext, id: string, dto: UpdateTeamDto): Promise<TeamDto> {
    const team = await this.prisma.team.findUnique({ where: { id } });
    if (!team) throw Errors.notFound('تیم');
    if (dto.leadId) await this.assertEmployee(dto.leadId);
    await this.prisma.$transaction(async (tx) => {
      await tx.team.update({
        where: { id },
        data: { name: dto.name, leadId: dto.leadId, status: dto.status },
      });
      if (dto.memberIds) {
        await tx.employee.updateMany({
          where: { teamId: id, id: { notIn: dto.memberIds } },
          data: { teamId: null },
        });
        await tx.employee.updateMany({ where: { id: { in: dto.memberIds } }, data: { teamId: id } });
      }
    });
    await this.audit.logFor(ctx, {
      action: AuditAction.TEAM_CHANGED,
      entityType: 'Team',
      entityId: id,
      metadata: { op: 'update', ...dto },
    });
    return (await this.listTeams(team.departmentId)).find((t) => t.id === id)!;
  }

  /* ------------------------------------------------------------ directory */

  /**
   * Organization directory for assignment pickers and @mentions. Names and titles are
   * visible org-wide; `assignable` reflects whether the caller may assign tasks to them.
   */
  async directory(ctx: AuthContext, q: DirectoryQuery): Promise<DirectoryEmployee[]> {
    const rows = await this.prisma.employee.findMany({
      where: {
        departmentId: q.departmentId,
        employmentStatus: { not: EmploymentStatus.TERMINATED },
        OR: [{ user: null }, { user: { status: UserStatus.ACTIVE } }],
      },
      orderBy: { fullName: 'asc' },
      include: { department: { select: { name: true } } },
    });
    const needle = q.q ? normalizePersian(q.q).toLowerCase() : null;
    return rows
      .filter((e) => !needle || normalizePersian(e.fullName).toLowerCase().includes(needle))
      .map((e) => ({
        id: e.id,
        fullName: e.fullName,
        jobTitle: e.jobTitle,
        departmentId: e.departmentId,
        departmentName: e.department.name,
        teamId: e.teamId,
        managerId: e.managerId,
        employmentStatus: e.employmentStatus,
        assignable: TaskPolicy.canAssignTo(ctx, e),
      }))
      .filter((e) => !q.assignableOnly || e.assignable);
  }

  private async assertEmployee(id: string) {
    const e = await this.prisma.employee.findUnique({ where: { id }, select: { id: true } });
    if (!e) throw Errors.validation('کارمند انتخاب‌شده یافت نشد.');
  }
}
