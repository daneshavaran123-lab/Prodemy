import { Injectable } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { Permission, reportScope, taskManageScope, taskViewScope } from '@karban/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthContext } from '../../common/auth-context';

const TEAM_PERMISSIONS: string[] = [
  Permission.TASK_VIEW_TEAM,
  Permission.TASK_MANAGE_TEAM,
  Permission.REPORT_VIEW_TEAM,
];

/** Builds the per-request AuthContext (role permissions + org relationships). */
@Injectable()
export class AuthContextLoader {
  constructor(private readonly prisma: PrismaService) {}

  async load(userId: string, sessionId: string): Promise<AuthContext | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        employee: {
          include: {
            ledTeams: { where: { status: 'ACTIVE' }, select: { id: true } },
            managedDepartments: { select: { id: true } },
          },
        },
      },
    });
    if (!user || user.status !== UserStatus.ACTIVE) return null;

    const permissions = new Set(user.role.permissions.map((rp) => rp.permission.code));
    const permissionList = [...permissions];
    const employee = user.employee;
    const ledTeamIds = employee.ledTeams.map((t) => t.id);
    const managesDepartmentIds = employee.managedDepartments.map((d) => d.id);

    let teamMemberIds: string[] = [];
    if (TEAM_PERMISSIONS.some((p) => permissions.has(p))) {
      const members = await this.prisma.employee.findMany({
        where: {
          id: { not: employee.id },
          OR: [...(ledTeamIds.length ? [{ teamId: { in: ledTeamIds } }] : []), { managerId: employee.id }],
        },
        select: { id: true },
      });
      teamMemberIds = members.map((m) => m.id);
    }

    return {
      userId: user.id,
      username: user.username,
      sessionId,
      employeeId: employee.id,
      fullName: employee.fullName,
      departmentId: employee.departmentId,
      teamId: employee.teamId,
      managerId: employee.managerId,
      roleId: user.roleId,
      roleCode: user.role.code,
      permissions,
      scopes: {
        taskView: taskViewScope(permissionList),
        taskManage: taskManageScope(permissionList),
        report: reportScope(permissionList),
      },
      departmentScopeIds: [...new Set([employee.departmentId, ...managesDepartmentIds])],
      managesDepartmentIds,
      ledTeamIds,
      teamMemberIds,
    };
  }
}
