import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from '../auth-context';

export const IS_PUBLIC_KEY = 'karban:isPublic';
export const SKIP_CSRF_KEY = 'karban:skipCsrf';
export const PERMISSIONS_KEY = 'karban:permissions';
export const ANY_PERMISSION_KEY = 'karban:anyPermission';

/** Route does not require an authenticated session. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Route is exempt from CSRF verification (machine-to-machine webhooks only). */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);

/** Requires every listed permission. */
export const RequirePermissions = (...codes: string[]) => SetMetadata(PERMISSIONS_KEY, codes);

/** Requires at least one of the listed permissions. */
export const RequireAnyPermission = (...codes: string[]) => SetMetadata(ANY_PERMISSION_KEY, codes);

export type AuthedRequest = Request & { auth?: AuthContext };

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  return req.auth;
});
