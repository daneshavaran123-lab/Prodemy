import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import { ANY_PERMISSION_KEY, IS_PUBLIC_KEY, PERMISSIONS_KEY, SKIP_CSRF_KEY, type AuthedRequest } from '../decorators';
import { Errors } from '../errors';
import { AuthContextLoader } from '../../modules/auth/auth-context.loader';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, SessionService } from '../../modules/auth/session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Global guard: CSRF (double-submit) → session → permission metadata.
 * Authorization on individual resources (department/team/ownership) is enforced in services.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly loader: AuthContextLoader,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const targets = [context.getHandler(), context.getClass()];

    const skipCsrf = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, targets);
    if (!skipCsrf && !SAFE_METHODS.has(req.method)) {
      const cookie = req.cookies?.[CSRF_COOKIE];
      const header = req.headers[CSRF_HEADER];
      if (!cookie || typeof header !== 'string' || !safeEqual(cookie, header)) {
        throw Errors.forbidden('توکن امنیتی درخواست نامعتبر است. صفحه را بازخوانی کنید.', 'CSRF_INVALID');
      }
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      const session = await this.sessions.validate(token);
      if (session) {
        const auth = await this.loader.load(session.userId, session.sessionId);
        if (auth) {
          auth.ip = req.ip;
          auth.userAgent = req.headers['user-agent'];
          req.auth = auth;
        }
      }
    }
    if (isPublic) return true;
    if (!req.auth) throw Errors.unauthorized();

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, targets);
    if (required?.length && !required.every((p) => req.auth!.permissions.has(p))) {
      throw Errors.forbidden();
    }
    const anyOf = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSION_KEY, targets);
    if (anyOf?.length && !anyOf.some((p) => req.auth!.permissions.has(p))) {
      throw Errors.forbidden();
    }
    return true;
  }
}
