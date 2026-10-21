import { Injectable } from '@nestjs/common';
import { AuditAction, NotificationType, RecordStatus, UserStatus } from '@prisma/client';
import { Permission, RoleCode, type SessionUser } from '@karban/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService, JOB_EMAIL } from '../notifications/notifications.service';
import { QueueService } from '../queue/queue.service';
import { InjectConfig } from '../../config/config.module';
import type { AppConfig } from '../../config/config';
import type { AuthContext } from '../../common/auth-context';
import { Errors } from '../../common/errors';
import { assertPasswordPolicy, burnPasswordCheck, hashPassword, verifyPassword } from './password';
import { randomToken, sha256, SessionService } from './session.service';
import type { ChangePasswordDto, ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto } from './auth.dto';

const RESET_TTL_MS = 60 * 60 * 1000;

interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly queue: QueueService,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  async registrationOptions() {
    const [departments, settings] = await Promise.all([
      this.prisma.department.findMany({
        where: { status: RecordStatus.ACTIVE },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      this.settings.get(),
    ]);
    return { departments, requiresApproval: settings.registrationRequiresApproval };
  }

  /**
   * Self-registration (PRD §14). Accounts start PENDING until an admin approves them,
   * unless approval is disabled in settings.
   */
  async register(dto: RegisterDto, client: ClientInfo) {
    assertPasswordPolicy(dto.password, dto.username);
    const settings = await this.settings.get();
    const department = await this.prisma.department.findFirst({
      where: { id: dto.departmentId, status: RecordStatus.ACTIVE },
    });
    if (!department) throw Errors.validation('دپارتمان انتخاب‌شده معتبر نیست.');
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ username: dto.username }, ...(dto.email ? [{ email: dto.email }] : [])] },
      select: { username: true },
    });
    if (existing) {
      throw Errors.conflict(
        existing.username === dto.username ? 'این نام کاربری قبلاً ثبت شده است.' : 'این ایمیل قبلاً ثبت شده است.',
        'DUPLICATE',
      );
    }
    const role = await this.prisma.role.findUniqueOrThrow({ where: { code: RoleCode.EMPLOYEE } });
    const passwordHash = await hashPassword(dto.password);
    const status = settings.registrationRequiresApproval ? UserStatus.PENDING : UserStatus.ACTIVE;

    const user = await this.prisma.$transaction(async (tx) => {
      const employeeCode = dto.employeeCode ?? (await nextEmployeeCode(tx));
      const employee = await tx.employee.create({
        data: {
          employeeCode,
          fullName: dto.fullName,
          jobTitle: dto.jobTitle,
          phone: dto.phone,
          departmentId: department.id,
          managerId: department.managerId,
        },
      });
      return tx.user.create({
        data: {
          username: dto.username,
          email: dto.email,
          passwordHash,
          status,
          roleId: role.id,
          employeeId: employee.id,
          passwordChangedAt: new Date(),
          approvedAt: status === UserStatus.ACTIVE ? new Date() : null,
        },
      });
    });

    await this.audit.log({
      action: AuditAction.REGISTERED,
      actorUserId: user.id,
      entityType: 'User',
      entityId: user.id,
      metadata: { username: user.username, departmentId: department.id, status },
      ...client,
    });
    if (status === UserStatus.PENDING) {
      await this.notifications.notify({
        userIds: await this.notifications.userIdsWithPermission(Permission.USER_MANAGE),
        type: NotificationType.ACCOUNT_PENDING_APPROVAL,
        title: 'درخواست ثبت‌نام جدید',
        body: `${dto.fullName} (${dto.username}) در دپارتمان ${department.name} ثبت‌نام کرده و منتظر تأیید است.`,
        link: '/admin/users?status=PENDING',
      });
    }
    return { status, requiresApproval: status === UserStatus.PENDING };
  }

  async login(dto: LoginDto, client: ClientInfo) {
    const user = await this.prisma.user.findUnique({ where: { username: dto.username } });
    const invalid = () => Errors.unauthorized('نام کاربری یا رمز عبور اشتباه است.');
    if (!user) {
      await burnPasswordCheck(dto.password);
      await this.audit.log({
        action: AuditAction.LOGIN_FAILED,
        entityType: 'User',
        metadata: { username: dto.username, reason: 'unknown_user' },
        ...client,
      });
      throw invalid();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.audit.log({
        action: AuditAction.LOGIN_FAILED,
        actorUserId: user.id,
        entityType: 'User',
        entityId: user.id,
        metadata: { reason: 'locked' },
        ...client,
      });
      throw Errors.unauthorized(
        'به دلیل تلاش‌های ناموفق متعدد، حساب شما موقتاً قفل شده است. چند دقیقه دیگر تلاش کنید.',
      );
    }
    const ok = await verifyPassword(user.passwordHash, dto.password);
    if (!ok) {
      const failed = user.failedLoginCount + 1;
      const lock = failed >= this.config.session.maxLoginAttempts;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: lock ? 0 : failed,
          lockedUntil: lock ? new Date(Date.now() + this.config.session.lockMinutes * 60_000) : undefined,
        },
      });
      await this.audit.log({
        action: AuditAction.LOGIN_FAILED,
        actorUserId: user.id,
        entityType: 'User',
        entityId: user.id,
        metadata: { reason: 'bad_password', locked: lock },
        ...client,
      });
      throw invalid();
    }
    if (user.status === UserStatus.PENDING) {
      throw Errors.forbidden('حساب کاربری شما هنوز توسط مدیر سیستم تأیید نشده است.');
    }
    if (user.status === UserStatus.DISABLED) {
      throw Errors.forbidden('حساب کاربری شما غیرفعال شده است.');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const token = await this.sessions.create(user.id, client.ip, client.userAgent);
    await this.audit.log({
      action: AuditAction.LOGIN,
      actorUserId: user.id,
      entityType: 'User',
      entityId: user.id,
      ...client,
    });
    return { token, userId: user.id };
  }

  async logout(ctx: AuthContext) {
    await this.sessions.revoke(ctx.sessionId);
    await this.audit.logFor(ctx, { action: AuditAction.LOGOUT, entityType: 'User', entityId: ctx.userId });
  }

  async changePassword(ctx: AuthContext, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    if (!(await verifyPassword(user.passwordHash, dto.currentPassword))) {
      throw Errors.validation('رمز عبور فعلی اشتباه است.');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw Errors.validation('رمز عبور جدید باید با رمز فعلی متفاوت باشد.');
    }
    assertPasswordPolicy(dto.newPassword, user.username);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(dto.newPassword),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      },
    });
    // Sign out every other device.
    await this.sessions.revokeAllForUser(user.id, ctx.sessionId);
    await this.audit.logFor(ctx, {
      action: AuditAction.PASSWORD_CHANGED,
      entityType: 'User',
      entityId: user.id,
    });
  }

  /** Always succeeds from the caller's view, to avoid account enumeration. */
  async forgotPassword(dto: ForgotPasswordDto, client: ClientInfo) {
    const user = await this.prisma.user.findFirst({
      where: {
        status: UserStatus.ACTIVE,
        OR: [{ username: dto.identifier }, { email: dto.identifier }],
      },
      include: { employee: true },
    });
    if (!user) return;
    await this.audit.log({
      action: AuditAction.PASSWORD_RESET_REQUESTED,
      actorUserId: user.id,
      entityType: 'User',
      entityId: user.id,
      metadata: { emailed: !!user.email },
      ...client,
    });
    if (!user.email) return;
    const token = randomToken();
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
    });
    await this.queue.enqueue(JOB_EMAIL, {
      to: user.email,
      subject: 'بازیابی رمز عبور کاربان',
      text: `${user.employee.fullName} عزیز،\n\nبرای تعیین رمز عبور جدید روی دکمه زیر کلیک کنید. این پیوند تا یک ساعت معتبر است.\n\nاگر این درخواست را شما ثبت نکرده‌اید، این پیام را نادیده بگیرید.`,
      link: `/reset-password?token=${token}`,
    });
  }

  async resetPassword(dto: ResetPasswordDto, client: ClientInfo) {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(dto.token) },
      include: { user: true },
    });
    if (!record || record.usedAt || record.expiresAt < new Date() || record.user.status !== UserStatus.ACTIVE) {
      throw Errors.validation('پیوند بازیابی نامعتبر یا منقضی شده است.');
    }
    assertPasswordPolicy(dto.newPassword, record.user.username);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: {
          passwordHash: await hashPassword(dto.newPassword),
          passwordChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
          mustChangePassword: false,
        },
      }),
      this.prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);
    await this.sessions.revokeAllForUser(record.userId);
    await this.audit.log({
      action: AuditAction.PASSWORD_RESET,
      actorUserId: record.userId,
      entityType: 'User',
      entityId: record.userId,
      ...client,
    });
  }

  async me(ctx: AuthContext): Promise<SessionUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: ctx.userId },
      include: { role: true, employee: { include: { department: true } } },
    });
    return {
      userId: user.id,
      username: user.username,
      email: user.email,
      mustChangePassword: user.mustChangePassword,
      employee: {
        id: user.employee.id,
        fullName: user.employee.fullName,
        jobTitle: user.employee.jobTitle,
        departmentId: user.employee.departmentId,
        departmentName: user.employee.department.name,
        teamId: user.employee.teamId,
        managerId: user.employee.managerId,
      },
      role: { id: user.role.id, code: user.role.code, name: user.role.name },
      permissions: [...ctx.permissions].sort(),
      scopes: ctx.scopes,
      managesDepartmentIds: ctx.managesDepartmentIds,
      departmentScopeIds: ctx.departmentScopeIds,
      preferences: {
        emailEnabled: user.emailNotifications,
        telegramEnabled: user.telegramNotifications,
        digestEnabled: user.digestEnabled,
      },
      telegramLinked: !!user.telegramChatId,
    };
  }
}

/** Next sequential employee code like E-0101. */
export async function nextEmployeeCode(tx: Pick<PrismaService, 'employee'>): Promise<string> {
  const count = await tx.employee.count();
  for (let n = count + 1; ; n++) {
    const code = `E-${String(n).padStart(4, '0')}`;
    if (!(await tx.employee.findUnique({ where: { employeeCode: code }, select: { id: true } }))) {
      return code;
    }
  }
}
