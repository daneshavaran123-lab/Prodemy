import { applyDecorators, Injectable, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { Throttle, ThrottlerGuard, type ThrottlerOptions } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import { SESSION_COOKIE } from '../../modules/auth/session.service';

const CREDENTIAL_ROUTE = 'karban:credentialRoute';

/** Integration tests log in many users from one address. */
export const skipThrottleInTests = () => process.env.NODE_ENV === 'test' && process.env.THROTTLE_IN_TESTS !== 'true';

const clientIp = (req: Record<string, any>): string => req.ip ?? req.socket?.remoteAddress ?? 'unknown';

/**
 * Throttlers: `default` for every route, keyed by {@link KarbanThrottlerGuard}; `credentialIp`
 * only on {@link CredentialRoute}s, keyed by address alone so rotating usernames from one
 * host stays bounded. Its limit leaves room for a whole office signing in behind one NAT.
 */
export const THROTTLERS: ThrottlerOptions[] = [
  { name: 'default', ttl: 60_000, limit: 600 },
  {
    name: 'credentialIp',
    ttl: 60_000,
    limit: 120,
    getTracker: (req) => `ip:${clientIp(req)}`,
    skipIf: (ctx: ExecutionContext) =>
      skipThrottleInTests() || !Reflect.getMetadata(CREDENTIAL_ROUTE, ctx.getHandler()),
  },
];

/** Login, registration and password-reset endpoints (PRD §102): 10/min per address + username. */
export const CredentialRoute = () =>
  applyDecorators(SetMetadata(CREDENTIAL_ROUTE, true), Throttle({ default: { limit: 10, ttl: 60_000 } }));

/**
 * Rate-limit key: the session for signed-in users, IP + username for credential
 * endpoints, IP otherwise. A whole office behind one NAT address must not share
 * a single bucket (PRD §97: 50+ concurrent users).
 */
@Injectable()
export class KarbanThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const ip = clientIp(req);
    const username = typeof req.body?.username === 'string' ? req.body.username.toLowerCase().slice(0, 64) : null;
    if (username) return `login:${ip}:${username}`;
    const session = req.cookies?.[SESSION_COOKIE];
    if (typeof session === 'string' && session) {
      return `session:${createHash('sha256').update(session).digest('hex').slice(0, 24)}`;
    }
    return `ip:${ip}`;
  }
}
