import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { InjectConfig } from '../../config/config.module';
import type { AppConfig } from '../../config/config';

export const SESSION_COOKIE = 'karban_session';
export const CSRF_COOKIE = 'karban_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Refresh the rolling expiry at most this often to avoid a write per request. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Server-side sessions (revocable, PRD §102 "Session Security").
 * The cookie holds an opaque random token; the database stores only its hash.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  private get ttlMs() {
    return this.config.session.ttlHours * 60 * 60 * 1000;
  }

  cookieOptions(httpOnly = true): CookieOptions {
    return {
      httpOnly,
      sameSite: 'lax',
      secure: this.config.session.cookieSecure,
      domain: this.config.session.cookieDomain,
      path: '/',
    };
  }

  async create(userId: string, ip?: string, userAgent?: string): Promise<string> {
    const token = randomToken();
    await this.prisma.session.create({
      data: {
        id: sha256(token),
        userId,
        expiresAt: new Date(Date.now() + this.ttlMs),
        ip,
        userAgent: userAgent?.slice(0, 500),
      },
    });
    return token;
  }

  /** Returns the session id (hash) and user id when the token is valid; extends rolling expiry. */
  async validate(token: string): Promise<{ sessionId: string; userId: string } | null> {
    const id = sha256(token);
    const session = await this.prisma.session.findUnique({ where: { id } });
    const now = Date.now();
    if (!session || session.revokedAt || session.expiresAt.getTime() <= now) return null;
    if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({
        where: { id },
        data: { lastSeenAt: new Date(now), expiresAt: new Date(now + this.ttlMs) },
      });
    }
    return { sessionId: id, userId: session.userId };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, id: exceptSessionId ? { not: exceptSessionId } : undefined },
      data: { revokedAt: new Date() },
    });
  }

  setSessionCookie(res: Response, token: string) {
    res.cookie(SESSION_COOKIE, token, { ...this.cookieOptions(), maxAge: this.ttlMs });
  }

  clearSessionCookie(res: Response) {
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  /** Issues a fresh double-submit CSRF token (readable by the SPA, sent back as a header). */
  issueCsrf(res: Response): string {
    const token = randomToken(24);
    res.cookie(CSRF_COOKIE, token, { ...this.cookieOptions(false), maxAge: this.ttlMs * 2 });
    return token;
  }
}
