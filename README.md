# کاربان (Karban)

سامانه هوشمند مدیریت وظایف سازمانی: وب‌اپلیکیشن فارسی، راست‌به‌چپ و با تقویم شمسی برای ثبت، ارجاع، پیگیری و
گزارش‌گیری وظایف در حدود ۱۰۰ نفر و ۸ دپارتمان، همراه با دستیار هوش مصنوعی که فقط پیشنهاد می‌دهد و هیچ‌وقت بدون
تأیید کاربر چیزی ثبت نمی‌کند.

- **وب:** Next.js 16 · React 19 · TypeScript · Tailwind 4 · TanStack Query (`apps/web`)
- **API:** NestJS 11 (Modular Monolith) · REST + OpenAPI · Prisma 6 · PostgreSQL 16 (`apps/api`)
- **پردازش پس‌زمینه:** Redis 7 + BullMQ در پروسه‌ی جداگانه‌ی worker
- **مشترک:** enumها، مجوزها، DTOها و توابع تاریخ/زمان (`packages/shared`)

معماری، مدل دسترسی، تصمیم‌های پیش‌فرض برای موارد «Needs Validation» سند PRD و نگاشت PRD به پیاده‌سازی در
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) آمده است.

## اجرای سریع با Docker Compose

```bash
cp .env.example .env               # رمزها را عوض کنید
docker compose up -d --build       # postgres, redis, minio, mailpit, api, worker, web
docker compose run --rm seed       # داده‌ی مرجع: مجوزها، نقش‌ها، ۸ دپارتمان، تنظیمات و ادمین
# اختیاری — سازمان نمونه‌ی ~۹۰ نفره با وظایف واقعی برای ارزیابی:
docker compose run --rm seed node dist/cli/seed.js --demo
```

| سرویس                       | آدرس                           |
| --------------------------- | ------------------------------ |
| وب‌اپلیکیشن                 | http://localhost:3000          |
| API و مستندات Swagger       | http://localhost:4000/api/docs |
| صندوق ایمیل آزمایشی Mailpit | http://localhost:8025          |
| کنسول MinIO (فایل‌ها)       | http://localhost:9001          |

اگر `SEED_ADMIN_PASSWORD` خالی باشد، seed یک رمز موقت برای `admin` چاپ می‌کند و در اولین ورود تغییر رمز اجباری
است. migrationها هنگام بالا آمدن کانتینر `api` خودکار اعمال می‌شوند.

## توسعه‌ی محلی

پیش‌نیاز: Node 22 (`.nvmrc`)، pnpm 10 (`corepack enable`)، PostgreSQL 16. Redis در حالت توسعه لازم نیست
(`QUEUE_DRIVER=inline` کارها را داخل پروسه‌ی API اجرا می‌کند).

```bash
corepack enable
pnpm install
cp apps/api/.env.example apps/api/.env      # DATABASE_URL را تنظیم کنید
cp apps/web/.env.example apps/web/.env      # فقط اگر API روی آدرس دیگری است
pnpm build:shared
pnpm db:migrate                              # prisma migrate dev
pnpm --filter @karban/api db:seed:demo       # یا db:seed برای داده‌ی مرجع بدون نمونه
pnpm dev                                     # API روی 4000 و وب روی 3000
```

وب درخواست‌های `/api/*` را به API پروکسی می‌کند، پس کوکی نشست و CSRF هر دو first-party هستند. برای اجرای جدای
worker با Redis: `QUEUE_DRIVER=redis` و `pnpm dev:worker`.

### حساب‌های نمونه

با `--demo` همه‌ی حساب‌ها رمز `Karban@1405` دارند (ادمین: رمزی که در `SEED_ADMIN_PASSWORD` گذاشته‌اید).

| نام کاربری                                                         | نقش                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------- |
| `admin`                                                            | مدیر سیستم — کاربران، نقش‌ها، تنظیمات، ممیزی (بدون دید وظایف) |
| `ceo`                                                              | مدیرعامل — دید کل سازمان                                      |
| `hr.manager` / `hr.specialist`                                     | مدیر منابع انسانی / کارشناس منابع انسانی                      |
| `sales.manager`، `ops.manager`، `finance.manager`، `it.manager`، … | مدیر دپارتمان                                                 |
| `sales.lead`، `marketing.lead`، `ops.supervisor`، `accountant`، …  | سرپرست تیم                                                    |
| `sales.rep`، `operator`، `developer`، `designer`                   | کارمند                                                        |

## تست و کیفیت کد

```bash
pnpm lint && pnpm typecheck && pnpm format:check
pnpm test        # shared (node:test) · web (vitest) · api (jest: unit + e2e)
```

تست‌های یکپارچه‌ی API روی یک پایگاه داده‌ی واقعی و جدا اجرا می‌شوند و جدول‌ها را بین تست‌ها خالی می‌کنند:
پیش‌فرض `postgresql://karban:karban@localhost:5432/karban_test`، قابل تغییر با `TEST_DATABASE_URL`. هرگز آن را
به پایگاه داده‌ی واقعی اشاره ندهید. همین مراحل به‌اضافه‌ی build و ساخت imageهای Docker در
`.github/workflows/ci.yml` اجرا می‌شود.

## پیکربندی

همه‌ی متغیرها با توضیح در `apps/api/src/config/config.ts` اعتبارسنجی می‌شوند؛ مهم‌ترین‌ها:

| متغیر                                      | توضیح                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `DATABASE_URL`                             | PostgreSQL                                                                            |
| `QUEUE_DRIVER` / `REDIS_URL`               | `redis` (پیش‌فرض، با worker) یا `inline` (تک‌پروسه)                                   |
| `APP_URL`                                  | آدرس عمومی وب؛ در لینک‌های ایمیل و تلگرام استفاده می‌شود                              |
| `COOKIE_SECURE`                            | پشت HTTPS حتماً `true` (در production پیش‌فرض `true` است)                             |
| `TRUST_PROXY`                              | یک hop پروکسی معکوس؛ برای IP درست در لاگ ممیزی و محدودیت نرخ                          |
| `STORAGE_DRIVER`                           | `local` یا `s3` (هر سرویس سازگار با S3، مثل MinIO)                                    |
| `SMTP_*`، `MAIL_FROM`                      | ارسال ایمیل؛ بدون آن اعلان‌ها فقط درون‌برنامه‌ای هستند                                |
| `TELEGRAM_MODE`، `TELEGRAM_BOT_*`          | `disabled`، `webhook` یا `polling`                                                    |
| `AI_PROVIDER`، `AI_BASE_URL`، `AI_API_KEY` | `disabled` یا هر endpoint سازگار با OpenAI؛ بدون آن تحلیل‌گر ابتکاری فارسی کار می‌کند |
| `SENTRY_DSN`                               | گزارش خطا (اختیاری)                                                                   |

تنظیمات کسب‌وکاری (روزهای کاری، تعطیلات رسمی، زمان‌بندی یادآوری‌ها، سقف حجم پیوست، تأیید ثبت‌نام و آستانه‌های
بار کاری) در خود برنامه، بخش «تنظیمات سیستم» ادمین، تغییر می‌کنند و هر تغییر در لاگ ممیزی ثبت می‌شود.

## پیش از استقرار در production

- HTTPS جلوی وب، `COOKIE_SECURE=true` و رمزهای قوی در `.env` یا secret store.
- پشتیبان‌گیری روزانه از PostgreSQL و باکت فایل‌ها (هدف PRD: RPO ≤ ۲۴ ساعت، RTO ≤ ۴ ساعت، نگهداری ۳۰ روز).
  Compose این کار را انجام نمی‌دهد.
- تعطیلات رسمی سال را در تنظیمات وارد کنید؛ محاسبه‌ی مهلت‌ها، تکرارها و یادآوری‌ها به آن وابسته است.
- اگر هوش مصنوعی فعال می‌شود، سیاست حریم داده را با ارائه‌دهنده نهایی کنید (جزئیات در ARCHITECTURE).

## ساختار مخزن

```
apps/api         NestJS API و worker، Prisma schema/migrations، seed، تست‌های e2e
apps/web         Next.js App Router؛ صفحات در src/app، اجزای UI در src/components
packages/shared  enumها، برچسب‌های فارسی، کدهای مجوز، DTOها، ابزار تاریخ و منطقه‌ی زمانی
```
