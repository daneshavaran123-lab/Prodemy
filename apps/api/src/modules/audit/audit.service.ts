import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import type { AuditLogDto, Paginated } from '@karban/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthContext } from '../../common/auth-context';

export interface AuditEntry {
  action: AuditAction;
  actorUserId?: string | null;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditQuery {
  action?: AuditAction;
  actorUserId?: string;
  entityType?: string;
  entityId?: string;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

/** Append-only security & admin audit trail (PRD §101). Never throws into callers. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          actorUserId: entry.actorUserId ?? null,
          entityType: entry.entityType,
          entityId: entry.entityId,
          metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent?.slice(0, 500) ?? null,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write audit log ${entry.action}: ${(err as Error).message}`);
    }
  }

  /** Convenience wrapper that fills actor and client info from the request context. */
  logFor(ctx: AuthContext, entry: Omit<AuditEntry, 'actorUserId' | 'ip' | 'userAgent'>) {
    return this.log({ ...entry, actorUserId: ctx.userId, ip: ctx.ip, userAgent: ctx.userAgent });
  }

  async list(q: AuditQuery): Promise<Paginated<AuditLogDto>> {
    const where: Prisma.AuditLogWhereInput = {
      action: q.action,
      actorUserId: q.actorUserId,
      entityType: q.entityType,
      entityId: q.entityId,
      createdAt: q.from || q.to ? { gte: q.from, lte: q.to } : undefined,
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          actor: { select: { id: true, username: true, employee: { select: { fullName: true } } } },
        },
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => ({
        id: r.id,
        action: r.action,
        actor: r.actor
          ? {
              userId: r.actor.id,
              username: r.actor.username,
              fullName: r.actor.employee?.fullName ?? null,
            }
          : null,
        entityType: r.entityType,
        entityId: r.entityId,
        metadata: r.metadata,
        ip: r.ip,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}
