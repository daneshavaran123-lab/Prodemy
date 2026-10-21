import { Logger } from '@nestjs/common';

/**
 * Optional Sentry integration (tech stack §24). Enabled only when SENTRY_DSN is set and
 * `@sentry/node` is installed, so local development and tests carry no dependency on it.
 */
let sentry: { captureException(e: unknown): void } | null = null;

export function initSentry(dsn: string | undefined, environment: string, service: string) {
  if (!dsn) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/node');
    Sentry.init({ dsn, environment, serverName: service, tracesSampleRate: 0.1 });
    sentry = Sentry;
    new Logger('Sentry').log('Error monitoring enabled');
  } catch {
    new Logger('Sentry').warn('SENTRY_DSN is set but @sentry/node is not installed; skipping');
  }
}

export function captureException(error: unknown) {
  sentry?.captureException(error);
}
