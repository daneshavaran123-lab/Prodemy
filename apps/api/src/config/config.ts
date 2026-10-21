import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .optional()
    .transform((v) => (v === undefined ? fallback : ['true', '1', 'yes'].includes(v)));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  APP_URL: z.string().url().default('http://localhost:3000'),
  APP_TIMEZONE: z.string().default('Asia/Tehran'),
  CORS_ORIGINS: optionalString,
  TRUST_PROXY: bool(true),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  /** `redis` (BullMQ) or `inline` (in-process, for tests / single-process dev). */
  QUEUE_DRIVER: z.enum(['redis', 'inline']).default('redis'),
  SCHEDULER_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(15),

  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  COOKIE_SECURE: optionalString,
  COOKIE_DOMAIN: optionalString,
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).default(15),

  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  MAIL_FROM: z.string().default('Karban <no-reply@karban.local>'),

  TELEGRAM_BOT_TOKEN: optionalString,
  TELEGRAM_BOT_USERNAME: optionalString,
  TELEGRAM_MODE: z.enum(['disabled', 'webhook', 'polling']).default('disabled'),
  TELEGRAM_WEBHOOK_SECRET: optionalString,
  TELEGRAM_API_BASE: z.string().default('https://api.telegram.org'),

  AI_PROVIDER: z.enum(['disabled', 'openai']).default('disabled'),
  AI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  AI_API_KEY: optionalString,
  AI_MODEL: z.string().default('gpt-4o-mini'),
  AI_TIMEOUT_MS: z.coerce.number().int().default(20000),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  S3_ENDPOINT: optionalString,
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY: optionalString,
  S3_SECRET_KEY: optionalString,
  S3_FORCE_PATH_STYLE: bool(true),

  SENTRY_DSN: optionalString,

  SEED_ADMIN_USERNAME: z.string().default('admin'),
  SEED_ADMIN_PASSWORD: optionalString,
  SEED_ADMIN_EMAIL: optionalString,
});

export type Env = z.infer<typeof schema>;

export interface AppConfig {
  env: Env['NODE_ENV'];
  isProduction: boolean;
  isTest: boolean;
  port: number;
  appUrl: string;
  timeZone: string;
  corsOrigins: string[];
  trustProxy: boolean;
  databaseUrl: string;
  redisUrl: string;
  queueDriver: Env['QUEUE_DRIVER'];
  schedulerIntervalMinutes: number;
  session: {
    ttlHours: number;
    cookieSecure: boolean;
    cookieDomain?: string;
    maxLoginAttempts: number;
    lockMinutes: number;
  };
  smtp: {
    host?: string;
    port: number;
    secure: boolean;
    user?: string;
    pass?: string;
    from: string;
  };
  telegram: {
    token?: string;
    botUsername?: string;
    mode: Env['TELEGRAM_MODE'];
    webhookSecret?: string;
    apiBase: string;
  };
  ai: {
    provider: Env['AI_PROVIDER'];
    baseUrl: string;
    apiKey?: string;
    model: string;
    timeoutMs: number;
  };
  storage: {
    driver: Env['STORAGE_DRIVER'];
    localDir: string;
    s3: {
      endpoint?: string;
      region: string;
      bucket?: string;
      accessKey?: string;
      secretKey?: string;
      forcePathStyle: boolean;
    };
  };
  sentryDsn?: string;
  seedAdmin: { username: string; password?: string; email?: string };
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';
  return {
    env: e.NODE_ENV,
    isProduction,
    isTest: e.NODE_ENV === 'test',
    port: e.PORT,
    appUrl: e.APP_URL.replace(/\/$/, ''),
    timeZone: e.APP_TIMEZONE,
    corsOrigins: e.CORS_ORIGINS ? e.CORS_ORIGINS.split(',').map((s) => s.trim()) : [],
    trustProxy: e.TRUST_PROXY,
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    queueDriver: e.QUEUE_DRIVER,
    schedulerIntervalMinutes: e.SCHEDULER_INTERVAL_MINUTES,
    session: {
      ttlHours: e.SESSION_TTL_HOURS,
      cookieSecure: e.COOKIE_SECURE ? e.COOKIE_SECURE === 'true' : isProduction,
      cookieDomain: e.COOKIE_DOMAIN,
      maxLoginAttempts: e.LOGIN_MAX_ATTEMPTS,
      lockMinutes: e.LOGIN_LOCK_MINUTES,
    },
    smtp: {
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_SECURE,
      user: e.SMTP_USER,
      pass: e.SMTP_PASS,
      from: e.MAIL_FROM,
    },
    telegram: {
      token: e.TELEGRAM_BOT_TOKEN,
      botUsername: e.TELEGRAM_BOT_USERNAME,
      mode: e.TELEGRAM_BOT_TOKEN ? e.TELEGRAM_MODE : 'disabled',
      webhookSecret: e.TELEGRAM_WEBHOOK_SECRET,
      apiBase: e.TELEGRAM_API_BASE.replace(/\/$/, ''),
    },
    ai: {
      provider: e.AI_PROVIDER,
      baseUrl: e.AI_BASE_URL.replace(/\/$/, ''),
      apiKey: e.AI_API_KEY,
      model: e.AI_MODEL,
      timeoutMs: e.AI_TIMEOUT_MS,
    },
    storage: {
      driver: e.STORAGE_DRIVER,
      localDir: e.STORAGE_LOCAL_DIR,
      s3: {
        endpoint: e.S3_ENDPOINT,
        region: e.S3_REGION,
        bucket: e.S3_BUCKET,
        accessKey: e.S3_ACCESS_KEY,
        secretKey: e.S3_SECRET_KEY,
        forcePathStyle: e.S3_FORCE_PATH_STYLE,
      },
    },
    sentryDsn: e.SENTRY_DSN,
    seedAdmin: {
      username: e.SEED_ADMIN_USERNAME,
      password: e.SEED_ADMIN_PASSWORD,
      email: e.SEED_ADMIN_EMAIL,
    },
  };
}
