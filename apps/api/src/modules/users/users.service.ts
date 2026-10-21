import { Injectable } from '@nestjs/common';
import { AuditAction, EmploymentStatus, NotificationType, Prisma, TaskStatus, UserStatus } from '@prisma/client';
import { randomBytes, randomInt } from 'node:crypto';
import { OPEN_TASK_STATUSES, Permission, type Paginated, type UserAdminDto } from '@karban/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SessionService } from '../auth/session.service';
import { assertPasswordPolicy, hashPassword } from '../auth/password';
import { nextEmployeeCode } from '../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { Errors } from '../../common/errors';
import { employeeRefSelect, iso, toEmployeeRef } from '../../common/serializers';
import type { CreateUserDto, ListUsersQuery, UpdateUserDto } from './users.dto';

const userInclude = {
  role: { select: { id: true, code: true, name: true } },
  employee: {
    include: {
      department: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
      manager: { select: employeeRefSelect },
      _count: {
        select: {
          ownedTasks: { where: { status: { in: OPEN_TASK_STATUSES as TaskStatus[] } } },
        },
      },
    },
  },
} satisfies Prisma.UserInclude;

type UserRow = Prisma.UserGetPayload<{ include: typeof userInclude }>;

function toDto(u: UserRow): UserAdminDto {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    status: u.status,
    role: u.role,
    employee: {
      id: u.employee.id,
      employeeCode: u.employee.employeeCode,
      fullName: u.employee.fullName,
      jobTitle: u.employee.jobTitle,
      department: u.employee.department,
      team: u.employee.team,
      manager: toEmployeeRef(u.employee.manager),
      employmentStatus: u.employee.employmentStatus,
      phone: u.employee.phone,
    },
    telegramLinked: !!u.telegramChatId,
    lastLoginAt: iso(u.lastLoginAt),
    createdAt: u.createdAt.toISOString(),
    openTaskCount: u.employee._count.ownedTasks,
  };
}

function temporaryPassword(): string {
  // 12 chars, guaranteed letters + digits.
  return `Kb${randomBytes(6).toString('base64url').replace(/[-_]/g, 'x')}${randomInt(10, 100)}`;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly sessions: SessionService,
  ) {}

  async list(q: ListUsersQuery): Promise<Paginated<UserAdminDto>> {
    const where: Prisma.UserWhereInput = {
      status: q.status,
      roleId: q.roleId,
      employee: q.departmentId ? { departmentId: q.departmentId } : undefined,
      OR: q.q
        ? [
            { username: { contains: q.q, mode: 'insensitive' } },
            { email: { contains: q.q, mode: 'insensitive' } },
            { employee: { fullName: { contains: q.q, mode: 'insensitive' } } },
            { employee: { employeeCode: { contains: q.q, mode: 'insensitive' } } },
          ]
        : undefined,
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        include: userInclude,
        orderBy: [{ status: 'asc' }, { employee: { fullName: 'asc' } }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, items: rows.map(toDto) };
  }

  async get(id: string): Promise<UserAdminDto> {
    const u = await this.prisma.user.findUnique({ where: { id }, include: userInclude });
    if (!u) throw Errors.notFound('کاربر');
    return toDto(u);
  }

  async create(ctx: AuthContext, dto: CreateUserDto): Promise<{ user: UserAdminDto; temporaryPassword?: string }> {
    const password = dto.password ?? temporaryPassword();
    assertPasswordPolicy(password, dto.username);
    await this.assertRefs(dto);
    const user = await this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.create({
        data: {
          employeeCode: dto.employeeCode ?? (await nextEmployeeCode(tx)),
          fullName: dto.fullName,
          jobTitle: dto.jobTitle,
          phone: dto.phone,
          departmentId: dto.departmentId,
          teamId: dto.teamId,
          managerId: dto.managerId,
        },
      });
      return tx.user.create({
        data: {
          username: dto.username,
          email: dto.email,
          passwordHash: await hashPassword(password),
          status: UserStatus.ACTIVE,
          roleId: dto.roleId,
          employeeId: employee.id,
          mustChangePassword: true,
          approvedAt: new Date(),
          approvedById: ctx.userId,
        },
      });
    });
    await this.audit.logFor(ctx, {
      action: AuditAction.USER_CREATED,
      entityType: 'User',
      entityId: user.id,
      metadata: { username: dto.username, roleId: dto.roleId, departmentId: dto.departmentId },
    });
    return { user: await this.get(user.id), temporaryPassword: dto.password ? undefined : password };
  }

  async update(ctx: AuthContext, id: string, dto: UpdateUserDto): Promise<UserAdminDto> {
    const before = await this.prisma.user.findUnique({ where: { id }, include: { employee: true, role: true } });
    if (!before) throw Errors.notFound('کاربر');
    await this.assertRefs(dto);
    if (dto.managerId && dto.managerId === before.employeeId) {
      throw Errors.validation('کارمند نمی‌تواند مدیر خودش باشد.');
    }
    if (dto.roleId && dto.roleId !== before.roleId) {
      await this.assertNotRemovingLastAdmin(before.id, before.roleId, dto.roleId);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { email: dto.email, roleId: dto.roleId },
      });
      await tx.employee.update({
        where: { id: before.employeeId },
        data: {
          fullName: dto.fullName,
          employeeCode: dto.employeeCode,
          jobTitle: dto.jobTitle,
          phone: dto.phone,
          departmentId: dto.departmentId,
          // Moving departments drops a team that belongs to the old one.
          teamId:
            dto.teamId !== undefined
              ? dto.teamId
              : dto.departmentId && dto.departmentId !== before.employee.departmentId
                ? null
                : undefined,
          managerId: dto.managerId,
          employmentStatus: dto.employmentStatus,
        },
      });
    });
    if (dto.roleId && dto.roleId !== before.roleId) {
      await this.audit.logFor(ctx, {
        action: AuditAction.ROLE_CHANGED,
        entityType: 'User',
        entityId: id,
        metadata: { from: before.role.code, toRoleId: dto.roleId },
      });
    }
    if (dto.departmentId && dto.departmentId !== before.employee.departmentId) {
      // Historical tasks keep their department context (PRD §87).
      await this.audit.logFor(ctx, {
        action: AuditAction.DEPARTMENT_CHANGED,
        entityType: 'Employee',
        entityId: before.employeeId,
        metadata: { from: before.employee.departmentId, to: dto.departmentId },
      });
    }
    await this.audit.logFor(ctx, {
      action: AuditAction.USER_UPDATED,
      entityType: 'User',
      entityId: id,
      metadata: { fields: Object.keys(dto) },
    });
    return this.get(id);
  }

  async approve(ctx: AuthContext, id: string): Promise<UserAdminDto> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw Errors.notFound('کاربر');
    if (user.status !== UserStatus.PENDING) throw Errors.validation('این حساب در انتظار تأیید نیست.');
    await this.prisma.user.update({
      where: { id },
      data: { status: UserStatus.ACTIVE, approvedAt: new Date(), approvedById: ctx.userId },
    });
    await this.audit.logFor(ctx, { action: AuditAction.USER_APPROVED, entityType: 'User', entityId: id });
    await this.notifications.notify({
      userIds: [id],
      type: NotificationType.SYSTEM,
      title: 'حساب کاربری شما تأیید شد',
      body: 'به کاربان خوش آمدید. اکنون می‌توانید وظایف خود را مشاهده و مدیریت کنید.',
      link: '/dashboard',
    });
    return this.get(id);
  }

  /**
   * Deactivation (PRD §86): sign-out everywhere, keep history, and alert managers of the
   * departing person's open tasks so they can be reassigned.
   */
  async disable(ctx: AuthContext, id: string, terminated = false): Promise<UserAdminDto> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { employee: true } });
    if (!user) throw Errors.notFound('کاربر');
    if (id === ctx.userId) throw Errors.validation('نمی‌توانید حساب خودتان را غیرفعال کنید.');
    await this.assertNotRemovingLastAdmin(id, user.roleId, null);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { status: UserStatus.DISABLED } }),
      ...(terminated
        ? [
            this.prisma.employee.update({
              where: { id: user.employeeId },
              data: { employmentStatus: EmploymentStatus.TERMINATED },
            }),
          ]
        : []),
    ]);
    await this.sessions.revokeAllForUser(id);
    await this.audit.logFor(ctx, {
      action: AuditAction.USER_DISABLED,
      entityType: 'User',
      entityId: id,
      metadata: { terminated },
    });

    const openTasks = await this.prisma.task.findMany({
      where: { primaryOwnerId: user.employeeId, status: { in: OPEN_TASK_STATUSES as TaskStatus[] } },
      select: { id: true, title: true, managerId: true, number: true },
    });
    const byManager = new Map<string, typeof openTasks>();
    for (const t of openTasks) {
      const list = byManager.get(t.managerId) ?? [];
      list.push(t);
      byManager.set(t.managerId, list);
    }
    for (const [managerId, tasks] of byManager) {
      await this.notifications.notify({
        employeeIds: [managerId],
        type: NotificationType.OWNER_DEACTIVATED,
        title: `نیاز به تخصیص مجدد ${tasks.length} وظیفه`,
        body: `حساب ${user.employee.fullName} غیرفعال شد. وظایف باز این فرد باید به مسئول دیگری سپرده شوند:\n${tasks
          .slice(0, 10)
          .map((t) => `• KB-${t.number} ${t.title}`)
          .join('\n')}`,
        link: `/tasks?ownerId=${user.employeeId}&status=open`,
        taskId: tasks.length === 1 ? tasks[0].id : null,
        actorEmployeeId: ctx.employeeId,
      });
    }
    return this.get(id);
  }

  async enable(ctx: AuthContext, id: string): Promise<UserAdminDto> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { employee: true } });
    if (!user) throw Errors.notFound('کاربر');
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { status: UserStatus.ACTIVE, failedLoginCount: 0, lockedUntil: null },
      }),
      ...(user.employee.employmentStatus === EmploymentStatus.TERMINATED
        ? [
            this.prisma.employee.update({
              where: { id: user.employeeId },
              data: { employmentStatus: EmploymentStatus.ACTIVE },
            }),
          ]
        : []),
    ]);
    await this.audit.logFor(ctx, { action: AuditAction.USER_ENABLED, entityType: 'User', entityId: id });
    return this.get(id);
  }

  async resetPassword(ctx: AuthContext, id: string): Promise<{ temporaryPassword: string }> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw Errors.notFound('کاربر');
    const password = temporaryPassword();
    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
        passwordChangedAt: new Date(),
      },
    });
    await this.sessions.revokeAllForUser(id);
    await this.audit.logFor(ctx, {
      action: AuditAction.PASSWORD_RESET,
      entityType: 'User',
      entityId: id,
      metadata: { byAdmin: true },
    });
    return { temporaryPassword: password };
  }

  private async assertRefs(dto: {
    departmentId?: string;
    teamId?: string | null;
    managerId?: string | null;
    roleId?: string;
  }) {
    if (dto.departmentId && !(await this.prisma.department.count({ where: { id: dto.departmentId } }))) {
      throw Errors.validation('دپارتمان یافت نشد.');
    }
    if (dto.teamId) {
      const team = await this.prisma.team.findUnique({ where: { id: dto.teamId } });
      if (!team) throw Errors.validation('تیم یافت نشد.');
      if (dto.departmentId && team.departmentId !== dto.departmentId) {
        throw Errors.validation('تیم انتخاب‌شده متعلق به این دپارتمان نیست.');
      }
    }
    if (dto.managerId && !(await this.prisma.employee.count({ where: { id: dto.managerId } }))) {
      throw Errors.validation('مدیر انتخاب‌شده یافت نشد.');
    }
    if (dto.roleId && !(await this.prisma.role.count({ where: { id: dto.roleId } }))) {
      throw Errors.validation('نقش یافت نشد.');
    }
  }

  /** Keeps at least one active user able to manage users. */
  private async assertNotRemovingLastAdmin(userId: string, currentRoleId: string, nextRoleId: string | null) {
    const holds = async (roleId: string) =>
      (await this.prisma.rolePermission.count({
        where: { roleId, permission: { code: Permission.USER_MANAGE } },
      })) > 0;
    if (!(await holds(currentRoleId))) return;
    if (nextRoleId && (await holds(nextRoleId))) return;
    const others = await this.prisma.user.count({
      where: {
        id: { not: userId },
        status: UserStatus.ACTIVE,
        role: { permissions: { some: { permission: { code: Permission.USER_MANAGE } } } },
      },
    });
    if (others === 0) throw Errors.validation('حداقل یک مدیر سیستم فعال باید باقی بماند.');
  }
}
