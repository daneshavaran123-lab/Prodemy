/**
 * Same-origin REST client. Next.js proxies /api/* to the NestJS backend, so the
 * httpOnly session cookie and the double-submit CSRF cookie are first-party.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | string[] | null | undefined>;

export function queryString(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) params.set(k, v.join(','));
    } else params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

let csrfLoading: Promise<void> | null = null;
async function ensureCsrf(force = false) {
  if (!force && readCookie('karban_csrf')) return;
  csrfLoading ??= fetch('/api/auth/csrf', { credentials: 'same-origin', cache: 'no-store' })
    .then(() => undefined)
    .finally(() => (csrfLoading = null));
  await csrfLoading;
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
}

export async function api<T>(path: string, opts: Options = {}, retry = true): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  if (method !== 'GET') {
    await ensureCsrf();
    headers['x-csrf-token'] = readCookie('karban_csrf') ?? '';
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}${queryString(opts.query)}`, {
      method,
      headers,
      body,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: opts.signal,
    });
  } catch {
    throw new ApiError(0, 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 403 && data?.code === 'CSRF_INVALID' && retry) {
      await ensureCsrf(true);
      return api<T>(path, opts, false);
    }
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/')) {
      window.dispatchEvent(new CustomEvent('karban:unauthorized'));
    }
    throw new ApiError(res.status, data?.message ?? 'خطا در پردازش درخواست.', data?.code, data?.details);
  }
  return data as T;
}

export const get = <T>(path: string, query?: Query) => api<T>(path, { query });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'VALIDATION' && Array.isArray(err.details) && err.details.length) {
      return `${err.message} (${(err.details as string[]).slice(0, 2).join('، ')})`;
    }
    return err.message;
  }
  return 'خطای غیرمنتظره رخ داد.';
}
