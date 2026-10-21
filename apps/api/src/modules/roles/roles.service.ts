import { Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { ALL_PERMISSIONS, PERMISSION_LABELS, Permission, type RoleDto } from '@karban/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../../common/auth-context';
import { Errors } from '../../common/errors';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listPermissions() {
    return ALL_PERMISSIONS.map((code) => ({ code, label: PERMISSION_LABELS[code] }));
  }

  async list(): Promise<RoleDto[]> {
    const roles = await this.prisma.role.findMany({
      orderBy: [{ system: 'desc' }, { name: 'asc' }],
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
    });
    return roles.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      system: r.system,
      permissions: r.permissions.map((p) => p.permission.code).sort(),
      userCount: r._count.users,
    }));
  }

  async create(
    ctx: AuthContext,
    dto: { code: string; name: string; description?: string; permissions: string[] },
  ): Promise<RoleDto> {
    this.assertKnown(dto.permissions);
    const perms = await this.prisma.permission.findMany({ where: { code: { in: dto.permissions } } });
    const role = await this.prisma.role.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
      },
    });
    await this.audit.logFor(ctx, {
      action: AuditAction.ROLE_CREATED,
      entityType: 'Role',
      entityId: role.id,
      metadata: { code: dto.code, permissions: dto.permissions },
    });
    return (await this.list()).find((r) => r.id === role.id)!;
  }

  async update(
    ctx: AuthContext,
    id: string,
    dto: { name?: string; description?: string; permissions?: string[] },
  ): Promise<RoleDto> {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) throw Errors.notFound('نقش');
    const before = role.permissions.map((p) => p.permission.code);
    if (dto.permissions) {
      this.assertKnown(dto.permissions);
      if (before.includes(Permission.USER_MANAGE) && !dto.permissions.includes(Permission.USER_MANAGE)) {
        await this.assertOtherAdminsRemain(id);
      }
      if (
        ctx.roleId === id &&
        before.includes(Permission.ROLE_MANAGE) &&
        !dto.permissions.includes(Permission.ROLE_MANAGE)
      ) {
        throw Errors.validation('نمی‌توانید مجوز مدیریت نقش‌ها را از نقش خودتان حذف کنید.');
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.role.update({ where: { id }, data: { name: dto.name, description: dto.description } });
      if (dto.permissions) {
        const perms = await tx.permission.findMany({ where: { code: { in: dto.permissions } } });
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({
          data: perms.map((p) => ({ roleId: id, permissionId: p.id })),
        });
      }
    });
    if (dto.permissions) {
      const after = [...dto.permissions].sort();
      await this.audit.logFor(ctx, {
        action: AuditAction.PERMISSION_CHANGED,
        entityType: 'Role',
        entityId: id,
        metadata: {
          role: role.code,
          added: after.filter((p) => !before.includes(p)),
          removed: before.filter((p) => !after.includes(p)),
        },
      });
    }
    return (await this.list()).find((r) => r.id === id)!;
  }

  async remove(ctx: AuthContext, id: string): Promise<void> {
    const role = await this.prisma.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
    if (!role) throw Errors.notFound('نقش');
    if (role.system) throw Errors.validation('نقش‌های پیش‌فرض سیستم قابل حذف نیستند.');
    if (role._count.users > 0) throw Errors.validation('این نقش به کاربرانی اختصاص داده شده است.');
    await this.prisma.role.delete({ where: { id } });
    await this.audit.logFor(ctx, {
      action: AuditAction.PERMISSION_CHANGED,
      entityType: 'Role',
      entityId: id,
      metadata: { op: 'delete', code: role.code },
    });
  }

  private assertKnown(codes: string[]) {
    const unknown = codes.filter((c) => !(ALL_PERMISSIONS as string[]).includes(c));
    if (unknown.length) throw Errors.validation(`مجوز نامعتبر: ${unknown.join(', ')}`);
  }

  private async assertOtherAdminsRemain(roleId: string) {
    const others = await this.prisma.user.count({
      where: {
        status: 'ACTIVE',
        roleId: { not: roleId },
        role: { permissions: { some: { permission: { code: Permission.USER_MANAGE } } } },
      },
    });
    if (!others) throw Errors.validation('حداقل یک نقش فعال باید مجوز مدیریت کاربران را داشته باشد.');
  }
}
