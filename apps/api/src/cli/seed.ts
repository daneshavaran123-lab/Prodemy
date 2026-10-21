/**
 * Seeds reference data (permissions, default roles, the 8 departments, settings, admin)
 * and, with `--demo`, a realistic ~90-person organization with tasks for evaluation.
 *
 *   pnpm --filter @karban/api db:seed           # reference data + admin
 *   pnpm --filter @karban/api db:seed:demo      # + demo organization
 *   node dist/cli/seed.js [--demo]              # production image
 *
 * Idempotent for reference data; demo data is only inserted into an empty task table.
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  BlockerType,
  CommentKind,
  DelayReasonType,
  EmploymentStatus,
  Prisma,
  RecurrenceFrequency,
  ReviewStatus,
  TaskEventType,
  TaskPriority,
  TaskStatus,
  UserStatus,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLES,
  PERMISSION_LABELS,
  RoleCode,
  addDaysToKey,
  zonedDateKey,
  zonedTimeToUtc,
} from '@karban/shared';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config';
import { DEFAULT_SETTINGS } from '../modules/settings/settings.service';
import { hashPassword } from '../modules/auth/password';
import { TasksService } from '../modules/tasks/tasks.service';
import { RiskService } from '../modules/risk/risk.service';
import { RecurrenceService } from '../modules/recurrence/recurrence.service';
import { recordHistory } from '../modules/tasks/task-history';
import { loadEnvFile } from '../config/env-file';

loadEnvFile();
// Seeding runs in-process; no Redis needed.
process.env.QUEUE_DRIVER = 'inline';

const log = new Logger('Seed');

export const DEPARTMENTS = [
  {
    code: 'MGMT',
    name: 'مدیریت و دفتر مدیرعامل',
    confidential: false,
    description: 'مدیرعامل، دستیار اجرایی و دفتر مدیریت',
  },
  { code: 'HR', name: 'منابع انسانی', confidential: false, description: 'جذب، حقوق و مزایا، آموزش و رفاه' },
  {
    code: 'FIN',
    name: 'مالی و حسابداری',
    confidential: true,
    description: 'حسابداری، خزانه‌داری و مالیات — دارای تفکیک امنیتی بالا',
  },
  { code: 'SALES', name: 'فروش و بازاریابی', confidential: false, description: 'فروش، مارکتینگ، تولید محتوا و برند' },
  { code: 'OPS', name: 'عملیات و تولید', confidential: false, description: 'سرپرستان، اپراتورها و کارشناسان اجرایی' },
  { code: 'IT', name: 'فناوری اطلاعات', confidential: false, description: 'توسعه، شبکه و زیرساخت، پشتیبانی و امنیت' },
  { code: 'CS', name: 'خدمات مشتریان', confidential: false, description: 'پشتیبانی و پاسخگویی به مشتریان' },
  { code: 'RND', name: 'تحقیق و توسعه', confidential: false, description: 'توسعه محصول، طراحی، تضمین کیفیت' },
] as const;

async function seedReference(prisma: PrismaService, config: AppConfig, resetRoles: boolean) {
  for (const code of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code },
      create: { code, description: PERMISSION_LABELS[code] },
      update: { description: PERMISSION_LABELS[code] },
    });
  }
  const permissions = await prisma.permission.findMany();
  const permId = new Map(permissions.map((p) => [p.code, p.id]));
  for (const role of DEFAULT_ROLES) {
    const existing = await prisma.role.findUnique({ where: { code: role.code } });
    if (existing && !resetRoles) continue;
    const r = await prisma.role.upsert({
      where: { code: role.code },
      create: { code: role.code, name: role.name, description: role.description, system: true },
      update: { name: role.name, description: role.description, system: true },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: r.id } });
    await prisma.rolePermission.createMany({
      data: role.permissions.map((code) => ({ roleId: r.id, permissionId: permId.get(code)! })),
    });
  }
  if ((await prisma.department.count()) === 0) {
    for (const d of DEPARTMENTS) await prisma.department.create({ data: d });
    log.log(`Created ${DEPARTMENTS.length} departments`);
  }
  await prisma.systemSetting.upsert({
    where: { key: 'system' },
    create: { key: 'system', value: DEFAULT_SETTINGS as unknown as Prisma.InputJsonValue },
    update: {},
  });

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: RoleCode.ADMIN } });
  const hasAdmin = await prisma.user.count({ where: { roleId: adminRole.id } });
  if (!hasAdmin) {
    const it =
      (await prisma.department.findFirst({ where: { code: 'IT' } })) ?? (await prisma.department.findFirstOrThrow());
    const password = config.seedAdmin.password ?? `Kb-${randomBytes(6).toString('base64url')}9`;
    const employee = await prisma.employee.create({
      data: { employeeCode: 'E-0001', fullName: 'مدیر سیستم', jobTitle: 'مدیر سیستم کاربان', departmentId: it.id },
    });
    await prisma.user.create({
      data: {
        username: config.seedAdmin.username,
        email: config.seedAdmin.email,
        passwordHash: await hashPassword(password),
        status: UserStatus.ACTIVE,
        roleId: adminRole.id,
        employeeId: employee.id,
        mustChangePassword: !config.seedAdmin.password,
        approvedAt: new Date(),
      },
    });
    log.log(
      `Admin user "${config.seedAdmin.username}" created${config.seedAdmin.password ? '' : ` with temporary password: ${password}`}`,
    );
  }
}

/* ======================================================================== demo data */

function prng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  'علی',
  'محمد',
  'حسین',
  'رضا',
  'مهدی',
  'امیر',
  'سعید',
  'حمید',
  'مجید',
  'پویا',
  'آرش',
  'کاوه',
  'بهزاد',
  'فرهاد',
  'مسعود',
  'نیما',
  'سینا',
  'بابک',
  'کامران',
  'وحید',
  'مریم',
  'زهرا',
  'فاطمه',
  'سارا',
  'نگار',
  'الهام',
  'نازنین',
  'لیلا',
  'شیرین',
  'مینا',
  'نرگس',
  'سمیرا',
  'پریسا',
  'هانیه',
  'ریحانه',
  'مهسا',
  'آزاده',
  'فرناز',
  'یاسمن',
  'ترانه',
];
const LAST = [
  'احمدی',
  'رضایی',
  'محمدی',
  'حسینی',
  'کریمی',
  'موسوی',
  'جعفری',
  'رحیمی',
  'صادقی',
  'نوری',
  'کاظمی',
  'شریفی',
  'رستمی',
  'صالحی',
  'قاسمی',
  'یوسفی',
  'اکبری',
  'عباسی',
  'مرادی',
  'نجفی',
  'زمانی',
  'طاهری',
  'فراهانی',
  'سلطانی',
  'باقری',
  'امینی',
  'حیدری',
  'پورمحمدی',
  'خسروی',
  'دهقان',
  'شجاعی',
  'میرزایی',
  'نیک‌نام',
  'وکیلی',
  'هاشمی',
];

interface PersonSpec {
  username?: string;
  fullName?: string;
  title: string;
  role: string;
  team?: string;
  leads?: string;
  managesDepartment?: boolean;
}

const ORG: Record<
  string,
  { teams: string[]; people: PersonSpec[]; filler: { count: number; titles: string[]; teams?: string[] } }
> = {
  MGMT: {
    teams: [],
    people: [
      { username: 'ceo', fullName: 'محمدرضا احمدی', title: 'مدیرعامل', role: RoleCode.CEO, managesDepartment: true },
      { username: 'exec.assistant', fullName: 'نگار صالحی', title: 'دستیار اجرایی', role: RoleCode.EMPLOYEE },
      { username: 'office.manager', fullName: 'کامران زمانی', title: 'مدیر دفتر', role: RoleCode.EMPLOYEE },
    ],
    filler: { count: 1, titles: ['منشی'] },
  },
  HR: {
    teams: ['جذب و آموزش'],
    people: [
      {
        username: 'hr.manager',
        fullName: 'مریم حسینی',
        title: 'مدیر منابع انسانی',
        role: RoleCode.HR_MANAGER,
        managesDepartment: true,
      },
      {
        username: 'hr.specialist',
        fullName: 'زهرا کاظمی',
        title: 'کارشناس جذب',
        role: RoleCode.HR,
        team: 'جذب و آموزش',
      },
    ],
    filler: {
      count: 4,
      titles: ['کارشناس حقوق و مزایا', 'مسئول آموزش و رفاه', 'کارشناس امور پرسنلی'],
      teams: ['جذب و آموزش'],
    },
  },
  FIN: {
    teams: ['حسابداری'],
    people: [
      {
        username: 'finance.manager',
        fullName: 'حمید رستمی',
        title: 'مدیر مالی',
        role: RoleCode.DEPARTMENT_MANAGER,
        managesDepartment: true,
      },
      {
        username: 'accountant',
        fullName: 'لیلا قاسمی',
        title: 'حسابدار ارشد',
        role: RoleCode.SUPERVISOR,
        leads: 'حسابداری',
        team: 'حسابداری',
      },
    ],
    filler: {
      count: 6,
      titles: ['حسابدار', 'حسابدار', 'کارشناس خزانه‌داری', 'مسئول مالیات', 'حسابدار'],
      teams: ['حسابداری'],
    },
  },
  SALES: {
    teams: ['تیم فروش', 'بازاریابی و محتوا'],
    people: [
      {
        username: 'sales.manager',
        fullName: 'علی رضایی',
        title: 'مدیر فروش',
        role: RoleCode.DEPARTMENT_MANAGER,
        managesDepartment: true,
      },
      {
        username: 'marketing.lead',
        fullName: 'سارا محمدی',
        title: 'مدیر مارکتینگ',
        role: RoleCode.SUPERVISOR,
        leads: 'بازاریابی و محتوا',
        team: 'بازاریابی و محتوا',
      },
      {
        username: 'sales.lead',
        fullName: 'مسعود یوسفی',
        title: 'سرپرست فروش',
        role: RoleCode.SUPERVISOR,
        leads: 'تیم فروش',
        team: 'تیم فروش',
      },
      {
        username: 'sales.rep',
        fullName: 'مهدی موسوی',
        title: 'کارشناس فروش',
        role: RoleCode.EMPLOYEE,
        team: 'تیم فروش',
      },
    ],
    filler: {
      count: 17,
      titles: [
        'کارشناس فروش',
        'کارشناس فروش',
        'کارشناس فروش',
        'تولیدکننده محتوا',
        'کارشناس تبلیغات دیجیتال',
        'کارشناس برند',
      ],
      teams: ['تیم فروش', 'بازاریابی و محتوا'],
    },
  },
  OPS: {
    teams: ['خط تولید ۱', 'خط تولید ۲', 'کنترل کیفیت و انبار'],
    people: [
      {
        username: 'ops.manager',
        fullName: 'رضا کریمی',
        title: 'مدیر عملیات',
        role: RoleCode.DEPARTMENT_MANAGER,
        managesDepartment: true,
      },
      {
        username: 'ops.supervisor',
        fullName: 'بهزاد طاهری',
        title: 'سرپرست خط تولید ۱',
        role: RoleCode.SUPERVISOR,
        leads: 'خط تولید ۱',
        team: 'خط تولید ۱',
      },
      {
        username: 'ops.supervisor2',
        fullName: 'فرهاد باقری',
        title: 'سرپرست خط تولید ۲',
        role: RoleCode.SUPERVISOR,
        leads: 'خط تولید ۲',
        team: 'خط تولید ۲',
      },
      {
        username: 'qc.supervisor',
        fullName: 'نرگس امینی',
        title: 'سرپرست کنترل کیفیت',
        role: RoleCode.SUPERVISOR,
        leads: 'کنترل کیفیت و انبار',
        team: 'کنترل کیفیت و انبار',
      },
      { username: 'operator', fullName: 'وحید دهقان', title: 'اپراتور', role: RoleCode.EMPLOYEE, team: 'خط تولید ۱' },
    ],
    filler: {
      count: 26,
      titles: ['اپراتور', 'اپراتور', 'اپراتور', 'کارشناس اجرایی', 'تکنسین نگهداری', 'انباردار'],
      teams: ['خط تولید ۱', 'خط تولید ۲', 'کنترل کیفیت و انبار'],
    },
  },
  IT: {
    teams: ['زیرساخت و پشتیبانی', 'توسعه نرم‌افزار'],
    people: [
      {
        username: 'it.manager',
        fullName: 'امیر نوری',
        title: 'مدیر فناوری اطلاعات',
        role: RoleCode.DEPARTMENT_MANAGER,
        managesDepartment: true,
      },
      {
        username: 'developer',
        fullName: 'سینا شجاعی',
        title: 'توسعه‌دهنده نرم‌افزار',
        role: RoleCode.EMPLOYEE,
        team: 'توسعه نرم‌افزار',
      },
    ],
    filler: {
      count: 5,
      titles: ['کارشناس شبکه و زیرساخت', 'کارشناس پشتیبانی', 'کارشناس امنیت', 'توسعه‌دهنده نرم‌افزار'],
      teams: ['زیرساخت و پشتیبانی', 'توسعه نرم‌افزار'],
    },
  },
  CS: {
    teams: ['پشتیبانی تلفنی', 'پاسخگویی آنلاین'],
    people: [
      {
        username: 'support.manager',
        fullName: 'الهام جعفری',
        title: 'مدیر پشتیبانی',
        role: RoleCode.DEPARTMENT_MANAGER,
        managesDepartment: true,
      },
      {
        username: 'support.lead',
        fullName: 'نیما خسروی',
        title: 'سرپرست پاسخگویی',
        role: RoleCode.SUPERVISOR,
        leads: 'پاسخگویی آنلاین',
        team: 'پاسخگویی آنلاین',
      },
    ],
    filler: {
      count: 8,
      titles: ['کارشناس پشتیبانی', 'کارشناس پاسخگویی'],
      teams: ['پشتیبانی تلفنی', 'پاسخگویی آنلاین'],
    },
  },
  RND: {
    teams: ['محصول و طراحی'],
    people: [
      {
        username: 'rnd.manager',
        fullName: 'پویا شریفی',
        title: 'مدیر توسعه محصول',
        role: RoleCode.DEPARTMENT_MANAGER,
        managesDepartment: true,
      },
      {
        username: 'designer',
        fullName: 'هانیه وکیلی',
        title: 'طراح UI/UX',
        role: RoleCode.EMPLOYEE,
        team: 'محصول و طراحی',
      },
    ],
    filler: {
      count: 5,
      titles: ['مهندس تضمین کیفیت (QA)', 'کارشناس تحقیق و توسعه', 'کارشناس محصول', 'طراح UI/UX'],
      teams: ['محصول و طراحی'],
    },
  },
};

const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const FILL: Record<string, string[]> = {
  customer: ['شرکت آریا', 'پخش البرز', 'فروشگاه‌های رفاه', 'گروه صنعتی پارس', 'بازرگانی نوین', 'هلدینگ سپهر'],
  city: ['تهران', 'اصفهان', 'شیراز', 'مشهد', 'تبریز', 'کرج'],
  line: ['۱', '۲', '۳'],
  machine: ['پرس هیدرولیک', 'دستگاه CNC شماره ۲', 'کمپرسور مرکزی', 'نوار نقاله بسته‌بندی'],
  module: ['پرداخت', 'گزارش‌گیری', 'ورود کاربران', 'سبد خرید'],
  product: ['سری X', 'نسخه موبایل', 'بسته سازمانی'],
  campaign: ['یلدا', 'نوروز', 'معرفی محصول جدید'],
  role: ['کارشناس فروش', 'حسابدار', 'اپراتور تولید', 'توسعه‌دهنده'],
  floor: ['دوم', 'سوم', 'چهارم'],
  n: ['۱۲۴', '۱۳۷', '۱۵۲', '۱۶۸'],
};
const TEMPLATES: Record<string, Array<[string, string, string?]>> = {
  MGMT: [
    ['تهیه دستور جلسه هیئت مدیره', 'گردآوری گزارش واحدها و تنظیم دستور جلسه ماهانه هیئت مدیره.', 'جلسات'],
    ['پیگیری مصوبات جلسه مدیران', 'پیگیری اجرای مصوبات جلسه هفتگی مدیران و تهیه گزارش وضعیت.', 'جلسات'],
    ['تهیه گزارش عملکرد فصلی برای سهامداران', 'جمع‌بندی شاخص‌های کلیدی فصل و تهیه ارائه برای سهامداران.', 'گزارش'],
    ['هماهنگی بازدید شرکای تجاری', 'هماهنگی برنامه بازدید هیئت تجاری از کارخانه و دفتر مرکزی.'],
  ],
  HR: [
    ['برگزاری مصاحبه برای موقعیت {role}', 'هماهنگی و برگزاری مصاحبه با داوطلبان واجد شرایط.', 'جذب'],
    [
      'محاسبه اضافه‌کار ماه {month}',
      'جمع‌آوری کارکرد و محاسبه اضافه‌کار کارکنان برای ارسال به واحد مالی.',
      'حقوق و مزایا',
    ],
    ['برگزاری دوره آشنایی کارکنان جدید', 'برنامه‌ریزی و اجرای جلسه معارفه و آشنایی با فرایندهای سازمان.', 'آموزش'],
    ['به‌روزرسانی آیین‌نامه مرخصی', 'بازبینی آیین‌نامه مرخصی مطابق قانون کار و اطلاع‌رسانی به کارکنان.'],
    ['تمدید قرارداد بیمه تکمیلی', 'استعلام از بیمه‌گرها و تمدید قرارداد بیمه تکمیلی کارکنان.', 'رفاه'],
  ],
  FIN: [
    ['تهیه صورت‌های مالی ماه {month}', 'بستن حساب‌ها و تهیه ترازنامه و صورت سود و زیان ماهانه.', 'گزارش مالی'],
    ['تطبیق حساب‌های بانکی', 'مغایرت‌گیری حساب‌های بانکی با دفاتر و رفع اختلاف‌ها.', 'خزانه‌داری'],
    ['ارسال اظهارنامه مالیات بر ارزش افزوده', 'تهیه و ارسال اظهارنامه فصلی مالیات بر ارزش افزوده در سامانه.', 'مالیات'],
    ['بررسی فاکتورهای خرید معوق', 'بررسی و تعیین تکلیف فاکتورهای خرید پرداخت‌نشده.', 'حسابداری'],
    ['پیش‌بینی جریان نقدی سه ماه آینده', 'تهیه پیش‌بینی جریان نقدی بر اساس فروش و تعهدات پرداخت.', 'خزانه‌داری'],
  ],
  SALES: [
    ['گزارش فروش {month}', 'تهیه گزارش فروش ماه به تفکیک محصول و نماینده.', 'گزارش'],
    ['پیگیری پیش‌فاکتور مشتری {customer}', 'تماس با مشتری و پیگیری تأیید پیش‌فاکتور ارسال‌شده.', 'مشتریان'],
    ['تماس با مشتریان غیرفعال', 'تماس با مشتریانی که در سه ماه اخیر خرید نداشته‌اند.', 'مشتریان'],
    ['تهیه کمپین تبلیغاتی {campaign}', 'طراحی پیام، کانال‌ها و بودجه کمپین تبلیغاتی.', 'بازاریابی'],
    ['تولید محتوای شبکه‌های اجتماعی هفته', 'تولید و زمان‌بندی محتوای هفتگی شبکه‌های اجتماعی.', 'محتوا'],
    ['برگزاری جلسه با نماینده {city}', 'بررسی عملکرد و برنامه فروش فصل آینده با نماینده.', 'نمایندگان'],
    ['تحلیل رقبا در بازار {city}', 'جمع‌آوری قیمت و پیشنهادهای رقبا و تهیه گزارش مقایسه‌ای.', 'بازاریابی'],
  ],
  OPS: [
    ['بازرسی ایمنی خط تولید {line}', 'بازرسی دوره‌ای تجهیزات ایمنی و ثبت موارد عدم انطباق.', 'ایمنی'],
    ['سفارش مواد اولیه تولید {month}', 'برآورد نیاز و ثبت سفارش مواد اولیه برای برنامه تولید ماه.', 'تأمین'],
    ['تعمیرات پیشگیرانه {machine}', 'انجام سرویس دوره‌ای و تعویض قطعات مصرفی.', 'نگهداری'],
    ['برنامه‌ریزی شیفت‌های هفته آینده', 'تنظیم برنامه شیفت اپراتورها با توجه به مرخصی‌ها.', 'برنامه‌ریزی'],
    ['کنترل کیفیت محموله شماره {n}', 'نمونه‌برداری و آزمون کیفی محموله پیش از ارسال.', 'کیفیت'],
    ['انبارگردانی ماهانه', 'شمارش موجودی انبار و تطبیق با سیستم.', 'انبار'],
    ['کاهش ضایعات خط {line}', 'تحلیل علل ضایعات و اجرای اقدامات اصلاحی.', 'بهبود'],
  ],
  IT: [
    ['به‌روزرسانی آنتی‌ویروس سیستم‌ها', 'به‌روزرسانی و بررسی وضعیت آنتی‌ویروس همه سیستم‌ها.', 'امنیت'],
    ['رفع مشکل شبکه طبقه {floor}', 'عیب‌یابی قطعی‌های مکرر شبکه و تعویض تجهیزات معیوب.', 'شبکه'],
    ['راه‌اندازی حساب کارکنان جدید', 'ایجاد ایمیل، دسترسی‌ها و تحویل سیستم به کارکنان جدید.', 'پشتیبانی'],
    ['تمدید لایسنس نرم‌افزار حسابداری', 'هماهنگی با تأمین‌کننده و تمدید لایسنس سالانه.', 'زیرساخت'],
    ['بررسی امنیتی دسترسی‌ها', 'بازبینی دسترسی کاربران به سامانه‌ها و حذف دسترسی‌های غیرضروری.', 'امنیت'],
    ['توسعه گزارش جدید در سامانه فروش', 'پیاده‌سازی گزارش فروش تجمیعی درخواست‌شده توسط واحد فروش.', 'توسعه'],
  ],
  CS: [
    ['پاسخ به تیکت‌های معوق مشتریان', 'بررسی و پاسخ به تیکت‌های بازِ بیش از ۴۸ ساعت.', 'تیکت'],
    ['پیگیری شکایت مشتری {customer}', 'بررسی علت شکایت، هماهنگی با واحد مربوط و اطلاع‌رسانی به مشتری.', 'شکایات'],
    ['تهیه گزارش رضایت مشتریان {month}', 'تحلیل نظرسنجی‌ها و تهیه گزارش رضایت ماهانه.', 'گزارش'],
    ['به‌روزرسانی پایگاه دانش پشتیبانی', 'افزودن پاسخ سؤالات پرتکرار جدید به پایگاه دانش.'],
  ],
  RND: [
    ['طراحی رابط کاربری نسخه جدید اپلیکیشن', 'طراحی صفحات اصلی و تهیه نمونه تعاملی برای بررسی.', 'طراحی'],
    ['تست کیفیت ماژول {module}', 'اجرای سناریوهای تست و ثبت باگ‌ها.', 'QA'],
    ['تحقیق بازار برای محصول {product}', 'مصاحبه با مشتریان و تحلیل نیازهای بازار.', 'تحقیق'],
    ['مستندسازی نیازمندی‌های ماژول {module}', 'تهیه سند نیازمندی‌ها و معیارهای پذیرش.', 'محصول'],
  ],
};
const COMMENTS = [
  'در حال بررسی هستم.',
  'پیش‌نویس اول آماده شد؛ لطفاً نظرتان را بفرمایید.',
  'لطفاً تا پایان امروز وضعیت را به‌روزرسانی کنید.',
  'منتظر پاسخ واحد مرتبط هستیم.',
  'نسخه نهایی ارسال شد.',
  'جلسه هماهنگی برای فردا ساعت ۱۰ تنظیم شد.',
];
const BLOCKERS: Array<[BlockerType, string, string]> = [
  [BlockerType.WAITING_DEPARTMENT, 'انتظار برای تأیید پرداخت از واحد مالی', 'FIN'],
  [BlockerType.WAITING_DEPARTMENT, 'منتظر دسترسی به سامانه از واحد فناوری اطلاعات', 'IT'],
  [BlockerType.MISSING_INFORMATION, 'اطلاعات فنی محصول هنوز از تحقیق و توسعه نرسیده است', 'RND'],
  [BlockerType.EXTERNAL, 'تأمین‌کننده هنوز قطعه را ارسال نکرده است', ''],
  [BlockerType.WAITING_DEPARTMENT, 'نیاز به تأیید نهایی مدیر عملیات', 'OPS'],
];
const DELAY_TYPES: DelayReasonType[] = [
  'WORKLOAD',
  'WAITING_OTHER_DEPARTMENT',
  'INCOMPLETE_INFORMATION',
  'SCOPE_CHANGE',
  'TECHNICAL_ISSUE',
  'CUSTOMER_DELAY',
  'LEAVE',
];

async function seedDemo(
  app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>,
  prisma: PrismaService,
  config: AppConfig,
) {
  if ((await prisma.task.count()) > 0) {
    log.warn('Tasks already exist — skipping demo data.');
    return;
  }
  const rand = prng(1405);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
  const tz = config.timeZone;
  const now = new Date();
  const day = 86_400_000;
  const password = await hashPassword('Karban@1405');
  const roles = new Map((await prisma.role.findMany()).map((r) => [r.code, r.id]));
  const departments = new Map((await prisma.department.findMany()).map((d) => [d.code, d]));
  const usedNames = new Set<string>();
  let codeSeq = (await prisma.employee.count()) + 1;
  const people: Array<{ id: string; dept: string; managerId: string | null; role: string; teamId: string | null }> = [];

  const uniqueName = () => {
    for (;;) {
      const n = `${pick(FIRST)} ${pick(LAST)}`;
      if (!usedNames.has(n)) {
        usedNames.add(n);
        return n;
      }
    }
  };
  Object.values(ORG).forEach((o) => o.people.forEach((p) => p.fullName && usedNames.add(p.fullName)));

  let ceoId: string | null = null;
  for (const [code, spec] of Object.entries(ORG)) {
    const dept = departments.get(code)!;
    const teams = new Map<string, string>();
    for (const name of spec.teams) {
      const t = await prisma.team.create({ data: { name, departmentId: dept.id } });
      teams.set(name, t.id);
    }
    let deptManagerId: string | null = null;
    const leads = new Map<string, string>();
    const specs: PersonSpec[] = [
      ...spec.people,
      ...Array.from({ length: spec.filler.count }, (_, i) => ({
        title: spec.filler.titles[i % spec.filler.titles.length],
        role: RoleCode.EMPLOYEE as string,
        team: spec.filler.teams ? spec.filler.teams[i % spec.filler.teams.length] : undefined,
      })),
    ];
    for (const p of specs) {
      const teamId = p.team ? teams.get(p.team)! : null;
      const managerId: string | null = p.managesDepartment
        ? code === 'MGMT'
          ? null
          : ceoId
        : ((p.team && !p.leads ? leads.get(p.team) : undefined) ?? deptManagerId);
      const employeeCode = `E-${String(codeSeq++).padStart(4, '0')}`;
      const onLeave = !p.username && rand() < 0.04;
      const e: { id: string } = await prisma.employee.create({
        data: {
          employeeCode,
          fullName: p.fullName ?? uniqueName(),
          jobTitle: p.title,
          departmentId: dept.id,
          teamId,
          managerId,
          employmentStatus: onLeave ? EmploymentStatus.ON_LEAVE : EmploymentStatus.ACTIVE,
          hiredAt: new Date(now.getTime() - Math.floor(rand() * 2000 + 100) * day),
        },
      });
      await prisma.user.create({
        data: {
          username: p.username ?? `e${employeeCode.slice(2)}`,
          email: `${p.username ?? `e${employeeCode.slice(2)}`}@karban.local`,
          passwordHash: password,
          status: UserStatus.ACTIVE,
          roleId: roles.get(p.role)!,
          employeeId: e.id,
          approvedAt: new Date(),
        },
      });
      if (p.managesDepartment) {
        deptManagerId = e.id;
        if (code === 'MGMT') ceoId = e.id;
        await prisma.department.update({ where: { id: dept.id }, data: { managerId: e.id } });
      }
      if (p.leads) {
        leads.set(p.leads, e.id);
        await prisma.team.update({ where: { id: teams.get(p.leads)! }, data: { leadId: e.id } });
      }
      people.push({ id: e.id, dept: code, managerId: managerId ?? e.id, role: p.role, teamId });
    }
  }
  // The admin's employee record reports to the IT manager.
  const itManager = departments.get('IT')!;
  const itDept = await prisma.department.findUniqueOrThrow({ where: { id: itManager.id } });
  await prisma.employee.updateMany({ where: { employeeCode: 'E-0001' }, data: { managerId: itDept.managerId } });
  log.log(`Created ${people.length} demo employees`);

  // Projects
  const projects = await Promise.all([
    prisma.project.create({
      data: { code: 'ERP-UPG', name: 'ارتقای سامانه ERP', departmentId: departments.get('IT')!.id },
    }),
    prisma.project.create({
      data: { code: 'YALDA-1405', name: 'کمپین فروش یلدا ۱۴۰۵', departmentId: departments.get('SALES')!.id },
    }),
    prisma.project.create({
      data: { code: 'LINE3', name: 'راه‌اندازی خط تولید ۳', departmentId: departments.get('OPS')!.id },
    }),
    prisma.project.create({
      data: { code: 'APP-V2', name: 'نسخه ۲ اپلیکیشن مشتریان', departmentId: departments.get('RND')!.id },
    }),
  ]);
  const projectFor: Record<string, string> = {
    IT: projects[0].id,
    SALES: projects[1].id,
    OPS: projects[2].id,
    RND: projects[3].id,
  };

  const tasks = app.get(TasksService);
  const fillTemplate = (s: string) =>
    s.replace(/\{(\w+)\}/g, (_, k: string) => (k === 'month' ? pick(MONTHS) : pick(FILL[k] ?? [''])));
  const todayKey = zonedDateKey(now, tz);
  let created = 0;

  for (const person of people) {
    if (person.role === RoleCode.CEO) continue;
    const count = 2 + Math.floor(rand() * 5);
    for (let i = 0; i < count; i++) {
      const [titleT, desc, category] = pick(TEMPLATES[person.dept]);
      // Deadlines from ~9 weeks ago to ~3 weeks ahead.
      const offsetDays = Math.floor(rand() * 85) - 62;
      const deadlineKey = addDaysToKey(todayKey, offsetDays);
      const deadline = zonedTimeToUtc(deadlineKey, rand() < 0.7 ? 23 : 16, rand() < 0.7 ? 59 : 0, tz);
      const span = 2 + Math.floor(rand() * 12);
      const startDate = new Date(deadline.getTime() - span * day);
      const createdAt = new Date(Math.min(startDate.getTime(), now.getTime() - 3600_000));
      const priority = pick<TaskPriority>(['LOW', 'NORMAL', 'NORMAL', 'NORMAL', 'HIGH', 'HIGH', 'URGENT']);
      const peers = people.filter((p) => p.dept === person.dept && p.id !== person.id);
      const collaborators = rand() < 0.3 && peers.length ? [pick(peers).id] : [];
      const creatorId = rand() < 0.2 ? person.id : (person.managerId ?? person.id);
      const past = deadline < now;

      const row = await prisma.$transaction((tx) =>
        tasks.createWithin(
          tx,
          {
            title: fillTemplate(titleT),
            description: desc,
            creatorId,
            departmentId: departments.get(person.dept)!.id,
            primaryOwnerId: person.id,
            managerId: person.managerId ?? person.id,
            collaboratorIds: collaborators,
            startDate,
            deadline,
            priority,
            status: TaskStatus.NOT_STARTED,
            category: category ?? null,
            tags: rand() < 0.25 ? [pick(['فوری-مشتری', 'فصلی', 'بهبود', 'قانونی'])] : [],
            projectId: projectFor[person.dept] && rand() < 0.3 ? projectFor[person.dept] : null,
            estimatedEffortHours: rand() < 0.5 ? Math.ceil(rand() * 24) : null,
            confidential: departments.get(person.dept)!.confidential,
            requiresReview: rand() < 0.25,
          },
          creatorId,
        ),
      );
      created++;

      // Lifecycle simulation with plausible timestamps.
      const roll = rand();
      const data: Prisma.TaskUncheckedUpdateInput = { createdAt, lastActivityAt: createdAt, lastProgressAt: createdAt };
      const events: Array<{
        type: TaskEventType;
        field?: string;
        old?: unknown;
        next?: unknown;
        at: Date;
        actor: string | null;
      }> = [];
      const startedAt = new Date(Math.min(startDate.getTime() + day * rand(), now.getTime() - 1800_000));
      let delayReason: DelayReasonType | null = null;

      // Older work is mostly closed; open overdue items cluster in the last ~10 days.
      const ageDays = -offsetDays;
      const closeShare = ageDays > 14 ? 0.95 : ageDays > 6 ? 0.85 : 0.55;
      if (past && roll < closeShare - 0.05) {
        const late = rand() < 0.22;
        const completedAt = late
          ? new Date(Math.min(deadline.getTime() + (1 + Math.floor(rand() * 6)) * day, now.getTime() - 3600_000))
          : new Date(
              Math.max(startedAt.getTime() + 3600_000, deadline.getTime() - Math.floor(rand() * 3) * day - 3600_000),
            );
        Object.assign(data, {
          status: TaskStatus.COMPLETED,
          progress: 100,
          completedAt,
          completedById: person.id,
          reviewStatus: row.requiresReview
            ? rand() < 0.7
              ? ReviewStatus.ACCEPTED
              : ReviewStatus.PENDING
            : ReviewStatus.NONE,
          lastActivityAt: completedAt,
          lastProgressAt: completedAt,
          overdueAt: late ? new Date(deadline.getTime() + 600_000) : null,
        });
        events.push({
          type: TaskEventType.STATUS_CHANGED,
          field: 'status',
          old: 'NOT_STARTED',
          next: 'IN_PROGRESS',
          at: startedAt,
          actor: person.id,
        });
        events.push({
          type: TaskEventType.COMPLETED,
          field: 'status',
          old: 'IN_PROGRESS',
          next: { status: 'COMPLETED' },
          at: completedAt,
          actor: person.id,
        });
        if (late) delayReason = pick(DELAY_TYPES);
      } else if (past && roll < closeShare) {
        Object.assign(data, {
          status: TaskStatus.CANCELLED,
          cancelledAt: new Date(deadline.getTime() - day),
          lastActivityAt: new Date(deadline.getTime() - day),
        });
        events.push({
          type: TaskEventType.CANCELLED,
          field: 'status',
          old: 'NOT_STARTED',
          next: { status: 'CANCELLED', reason: 'تغییر اولویت‌های واحد' },
          at: new Date(deadline.getTime() - day),
          actor: person.managerId,
        });
      } else {
        // Open task (overdue if the deadline passed).
        const status = pick<TaskStatus>([
          'NOT_STARTED',
          'IN_PROGRESS',
          'IN_PROGRESS',
          'IN_PROGRESS',
          'WAITING',
          'BLOCKED',
        ]);
        const elapsed = Math.max(
          0,
          Math.min(1, (now.getTime() - startDate.getTime()) / (deadline.getTime() - startDate.getTime())),
        );
        const progress =
          status === 'NOT_STARTED' ? 0 : Math.min(95, Math.round((elapsed * 100 * (0.4 + rand() * 0.9)) / 5) * 5);
        const lastProgressAt = new Date(now.getTime() - Math.floor(rand() * 6) * day - 3600_000);
        Object.assign(data, {
          status,
          progress,
          lastProgressAt:
            status === 'NOT_STARTED' ? createdAt : new Date(Math.max(lastProgressAt.getTime(), createdAt.getTime())),
          lastActivityAt: new Date(Math.max(lastProgressAt.getTime(), createdAt.getTime())),
          overdueAt: past ? new Date(deadline.getTime() + 600_000) : null,
        });
        if (status !== 'NOT_STARTED') {
          events.push({
            type: TaskEventType.STATUS_CHANGED,
            field: 'status',
            old: 'NOT_STARTED',
            next: status === 'BLOCKED' ? 'IN_PROGRESS' : status,
            at: startedAt,
            actor: person.id,
          });
          if (progress > 0)
            events.push({
              type: TaskEventType.PROGRESS_CHANGED,
              field: 'progress',
              old: 0,
              next: progress,
              at: new Date(Math.max(startedAt.getTime() + 600_000, (data.lastProgressAt as Date).getTime())),
              actor: person.id,
            });
        }
        if (status === 'BLOCKED') {
          const [type, description, blockingCode] = pick(BLOCKERS.filter((b) => b[2] !== person.dept));
          const blockedAt = new Date(
            Math.max(startedAt.getTime() + 3600_000, now.getTime() - Math.ceil(rand() * 6) * day),
          );
          await prisma.blocker.create({
            data: {
              taskId: row.id,
              type,
              description,
              blockingDepartmentId: blockingCode ? departments.get(blockingCode)!.id : null,
              blockingPartyNote: blockingCode ? null : 'تأمین‌کننده خارجی',
              expectedResolutionAt: new Date(now.getTime() + Math.ceil(rand() * 5) * day),
              createdById: person.id,
              createdAt: blockedAt,
            },
          });
          events.push({
            type: TaskEventType.STATUS_CHANGED,
            field: 'status',
            old: 'IN_PROGRESS',
            next: 'BLOCKED',
            at: blockedAt,
            actor: person.id,
          });
          events.push({
            type: TaskEventType.BLOCKER_ADDED,
            next: { type, description },
            at: blockedAt,
            actor: person.id,
          });
        }
        if (past) {
          events.push({
            type: TaskEventType.MARKED_OVERDUE,
            field: 'deadline',
            next: { deadline: deadline.toISOString() },
            at: new Date(deadline.getTime() + 600_000),
            actor: null,
          });
          if (rand() < 0.5) delayReason = pick(DELAY_TYPES);
        }
      }
      await prisma.task.update({ where: { id: row.id }, data });
      await prisma.taskHistory.updateMany({ where: { taskId: row.id }, data: { createdAt } });
      for (const e of events) {
        await prisma.taskHistory.create({
          data: {
            taskId: row.id,
            actorId: e.actor,
            eventType: e.type,
            field: e.field ?? null,
            oldValue: e.old === undefined ? undefined : (e.old as Prisma.InputJsonValue),
            newValue: e.next === undefined ? undefined : (e.next as Prisma.InputJsonValue),
            createdAt: e.at,
          },
        });
      }
      if (delayReason) {
        const at = new Date(Math.min(deadline.getTime() + day, now.getTime() - 600_000));
        await prisma.delayReason.create({
          data: {
            taskId: row.id,
            reasonType: delayReason,
            description: delayReason === 'WAITING_OTHER_DEPARTMENT' ? 'پاسخ واحد همکار با تأخیر دریافت شد.' : null,
            deadlineAt: deadline,
            createdById: person.id,
            createdAt: at,
          },
        });
        await recordHistory(prisma, row.id, person.id, [
          { eventType: TaskEventType.DELAY_REASON_ADDED, newValue: { reasonType: delayReason } },
        ]);
      }
      const commentCount = Math.floor(rand() * 3);
      for (let c = 0; c < commentCount; c++) {
        const at = new Date(Math.min(createdAt.getTime() + (c + 1) * day * rand() * 3, now.getTime() - 600_000));
        await prisma.taskComment.create({
          data: {
            taskId: row.id,
            authorId: c % 2 === 0 ? person.id : person.managerId,
            content: pick(COMMENTS),
            kind: rand() < 0.15 ? CommentKind.DECISION : CommentKind.COMMENT,
            createdAt: at,
          },
        });
      }
    }
  }
  log.log(`Created ${created} demo tasks`);
  await seedScenarios(prisma, tasks, departments, tz);

  // Recurring templates (PRD §26 example: weekly sales report every Saturday).
  const recurrence = app.get(RecurrenceService);
  const byUsername = async (u: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { username: u }, include: { employee: true } })).employee;
  const salesRep = await byUsername('sales.rep');
  const salesMgr = await byUsername('sales.manager');
  const itDev = await byUsername('developer');
  const itMgr = await byUsername('it.manager');
  const operator = await byUsername('operator');
  const opsSup = await byUsername('ops.supervisor');
  const nextSat = addDaysToKey(todayKey, (6 - new Date(`${todayKey}T12:00:00Z`).getUTCDay() + 7) % 7 || 7);
  const templates = [
    {
      title: 'گزارش فروش هفتگی',
      description: 'تهیه گزارش فروش هفته گذشته به تفکیک محصول و ارسال برای مدیر فروش.',
      owner: salesRep,
      manager: salesMgr,
      dept: 'SALES',
      frequency: RecurrenceFrequency.WEEKLY,
      weekdays: [6],
      start: nextSat,
      priority: TaskPriority.HIGH,
    },
    {
      title: 'پشتیبان‌گیری هفتگی از سرورها',
      description: 'اجرای پشتیبان کامل از سرورهای فایل و پایگاه داده و آزمون بازیابی نمونه.',
      owner: itDev,
      manager: itMgr,
      dept: 'IT',
      frequency: RecurrenceFrequency.WEEKLY,
      weekdays: [3],
      start: addDaysToKey(todayKey, 1),
      priority: TaskPriority.NORMAL,
    },
    {
      title: 'بازرسی روزانه ایمنی خط ۱',
      description: 'بازدید چک‌لیست ایمنی پیش از شروع شیفت.',
      owner: operator,
      manager: opsSup,
      dept: 'OPS',
      frequency: RecurrenceFrequency.DAILY,
      weekdays: [],
      start: addDaysToKey(todayKey, 1),
      priority: TaskPriority.NORMAL,
    },
  ];
  for (const t of templates) {
    await prisma.$transaction(async (tx) => {
      const deadline = zonedTimeToUtc(t.start, 16, 0, tz);
      const rule = await recurrence.createRule(tx, {
        title: t.title,
        description: t.description,
        creatorId: t.manager.id,
        departmentId: departments.get(t.dept)!.id,
        primaryOwnerId: t.owner.id,
        managerId: t.manager.id,
        collaboratorIds: [],
        priority: t.priority,
        tags: ['تکراری'],
        confidential: false,
        requiresReview: false,
        deadline,
        frequency: t.frequency,
        interval: 1,
        weekdays: t.weekdays,
        dayOfMonth: null,
        durationDays: 0,
        startDate: t.start,
        endDate: null,
      });
      await tasks.createWithin(
        tx,
        {
          title: t.title,
          description: t.description,
          creatorId: t.manager.id,
          departmentId: departments.get(t.dept)!.id,
          primaryOwnerId: t.owner.id,
          managerId: t.manager.id,
          collaboratorIds: [],
          startDate: zonedTimeToUtc(t.start, 0, 0, tz),
          deadline,
          priority: t.priority,
          status: TaskStatus.NOT_STARTED,
          tags: ['تکراری'],
          confidential: false,
          requiresReview: false,
          recurrenceId: rule.id,
          recurrenceOccurrence: t.start,
        },
        t.manager.id,
      );
    });
  }
  await app.get(RiskService).refresh();
  log.log('Demo data ready. All demo accounts use the password: Karban@1405');
  log.log(
    'Key accounts: ceo, hr.manager, finance.manager, sales.manager, marketing.lead, sales.rep, ops.manager, ops.supervisor, operator, it.manager, support.manager, rnd.manager',
  );
}

/**
 * Hand-written situations for the main demo logins so every dashboard section has
 * something to show: due today, overdue without a reason, blocked, high priority, collaboration.
 */
async function seedScenarios(
  prisma: PrismaService,
  tasks: TasksService,
  departments: Map<string, { id: string; confidential: boolean }>,
  tz: string,
) {
  const now = new Date();
  const day = 86_400_000;
  const todayKey = zonedDateKey(now, tz);
  const emp = async (u: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { username: u }, include: { employee: true } })).employee;
  const at = (days: number, h = 17, m = 0) => zonedTimeToUtc(addDaysToKey(todayKey, days), h, m, tz);
  const scenarios: Array<{
    owner: string;
    manager: string;
    dept: string;
    title: string;
    description: string;
    deadline: Date;
    priority: TaskPriority;
    status: TaskStatus;
    progress: number;
    startedDaysAgo: number;
    collaborators?: string[];
    blocker?: { description: string; dept: string };
    requiresReview?: boolean;
    completed?: boolean;
  }> = [
    {
      owner: 'sales.rep',
      manager: 'sales.lead',
      dept: 'SALES',
      title: 'ارسال پیش‌فاکتور به هلدینگ سپهر',
      description: 'تهیه و ارسال پیش‌فاکتور نهایی بر اساس جلسه دیروز با مدیر خرید.',
      deadline: at(0, 16),
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      progress: 60,
      startedDaysAgo: 2,
    },
    {
      owner: 'sales.rep',
      manager: 'sales.lead',
      dept: 'SALES',
      title: 'پیگیری مطالبات معوق فروشگاه‌های رفاه',
      description: 'تماس با واحد مالی مشتری و هماهنگی زمان پرداخت فاکتورهای شهریور.',
      deadline: at(-2, 17),
      priority: 'URGENT',
      status: 'IN_PROGRESS',
      progress: 40,
      startedDaysAgo: 8,
    },
    {
      owner: 'sales.rep',
      manager: 'sales.lead',
      dept: 'SALES',
      title: 'به‌روزرسانی لیست قیمت نمایندگان',
      description: 'اعمال افزایش قیمت مصوب و ارسال لیست جدید برای نمایندگان استان‌ها.',
      deadline: at(2, 12),
      priority: 'HIGH',
      status: 'BLOCKED',
      progress: 30,
      startedDaysAgo: 3,
      blocker: { description: 'منتظر تأیید نهایی نرخ‌ها از واحد مالی', dept: 'FIN' },
    },
    {
      owner: 'sales.rep',
      manager: 'sales.lead',
      dept: 'SALES',
      title: 'آماده‌سازی ارائه برای نمایشگاه صنعت',
      description: 'اسلایدهای معرفی محصولات و جدول تخفیف ویژه نمایشگاه.',
      deadline: at(5, 18),
      priority: 'NORMAL',
      status: 'NOT_STARTED',
      progress: 0,
      startedDaysAgo: 0,
      collaborators: ['marketing.lead'],
    },
    {
      owner: 'marketing.lead',
      manager: 'sales.manager',
      dept: 'SALES',
      title: 'طراحی بنر کمپین یلدا',
      description: 'طراحی بنر شبکه‌های اجتماعی و صفحه اصلی سایت برای کمپین یلدا.',
      deadline: at(3, 17),
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      progress: 50,
      startedDaysAgo: 4,
      collaborators: ['sales.rep'],
      requiresReview: true,
    },
    {
      owner: 'operator',
      manager: 'ops.supervisor',
      dept: 'OPS',
      title: 'تعویض فیلتر کمپرسور خط ۱',
      description: 'تعویض فیلتر طبق برنامه نگهداری و ثبت در دفترچه دستگاه.',
      deadline: at(0, 14),
      priority: 'HIGH',
      status: 'NOT_STARTED',
      progress: 0,
      startedDaysAgo: 1,
    },
    {
      owner: 'operator',
      manager: 'ops.supervisor',
      dept: 'OPS',
      title: 'گزارش توقفات شیفت شب',
      description: 'ثبت علت و مدت توقفات خط در شیفت گذشته.',
      deadline: at(-1, 10),
      priority: 'NORMAL',
      status: 'IN_PROGRESS',
      progress: 70,
      startedDaysAgo: 2,
    },
  ];
  for (const sc of scenarios) {
    const owner = await emp(sc.owner);
    const manager = await emp(sc.manager);
    const collaboratorIds = await Promise.all((sc.collaborators ?? []).map(async (u) => (await emp(u)).id));
    const startDate = new Date(now.getTime() - sc.startedDaysAgo * day - 3600_000);
    const task = await prisma.$transaction((tx) =>
      tasks.createWithin(
        tx,
        {
          title: sc.title,
          description: sc.description,
          creatorId: manager.id,
          departmentId: departments.get(sc.dept)!.id,
          primaryOwnerId: owner.id,
          managerId: manager.id,
          collaboratorIds,
          startDate,
          deadline: sc.deadline,
          priority: sc.priority,
          status: TaskStatus.NOT_STARTED,
          tags: [],
          confidential: false,
          requiresReview: !!sc.requiresReview,
        },
        manager.id,
      ),
    );
    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: sc.status,
        progress: sc.progress,
        createdAt: startDate,
        lastActivityAt: new Date(now.getTime() - 2 * 3600_000),
        lastProgressAt: new Date(
          now.getTime() - (sc.status === 'NOT_STARTED' ? sc.startedDaysAgo * day : 5 * 3600_000),
        ),
        overdueAt: sc.deadline < now ? new Date(sc.deadline.getTime() + 600_000) : null,
      },
    });
    await prisma.taskHistory.updateMany({ where: { taskId: task.id }, data: { createdAt: startDate } });
    if (sc.status !== 'NOT_STARTED') {
      await recordHistory(prisma, task.id, owner.id, [
        {
          eventType: TaskEventType.STATUS_CHANGED,
          field: 'status',
          oldValue: 'NOT_STARTED',
          newValue: sc.status === 'BLOCKED' ? 'IN_PROGRESS' : sc.status,
        },
        { eventType: TaskEventType.PROGRESS_CHANGED, field: 'progress', oldValue: 0, newValue: sc.progress },
      ]);
    }
    if (sc.blocker) {
      await prisma.blocker.create({
        data: {
          taskId: task.id,
          type: BlockerType.WAITING_DEPARTMENT,
          description: sc.blocker.description,
          blockingDepartmentId: departments.get(sc.blocker.dept)!.id,
          expectedResolutionAt: at(1),
          createdById: owner.id,
        },
      });
      await recordHistory(prisma, task.id, owner.id, [
        { eventType: TaskEventType.STATUS_CHANGED, field: 'status', oldValue: 'IN_PROGRESS', newValue: 'BLOCKED' },
        {
          eventType: TaskEventType.BLOCKER_ADDED,
          newValue: { type: 'WAITING_DEPARTMENT', description: sc.blocker.description },
        },
      ]);
    }
    await prisma.taskComment.create({
      data: {
        taskId: task.id,
        authorId: manager.id,
        content: 'لطفاً وضعیت را تا پایان روز به‌روزرسانی کنید.',
        createdAt: new Date(now.getTime() - 3 * 3600_000),
      },
    });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const prisma = app.get(PrismaService);
    const config = app.get<AppConfig>(APP_CONFIG);
    await seedReference(prisma, config, args.includes('--reset-roles'));
    if (args.includes('--demo')) await seedDemo(app, prisma, config);
    log.log('Seed completed');
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    log.error(err);
    process.exit(1);
  });
}

export { seedReference };
