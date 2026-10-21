import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { RoleCode, addDaysToKey, zonedDateKey, zonedTimeToUtc } from '@karban/shared';
import { UserStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { APP_CONFIG } from '../src/config/config.module';
import type { AppConfig } from '../src/config/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { QueueService } from '../src/modules/queue/queue.service';
import { EmailChannel, type EmailMessage } from '../src/modules/notifications/channels/email.channel';
import { hashPassword } from '../src/modules/auth/password';
import { seedReference } from '../src/cli/seed';

export const PASSWORD = 'Test@12345';
export const TZ = 'Asia/Tehran';

/** Captures outgoing e-mail instead of talking to SMTP. */
export class FakeEmail extends EmailChannel {
  sent: EmailMessage[] = [];
  override get configured() {
    return true;
  }
  override async send(message: EmailMessage) {
    this.sent.push(message);
  }
}

export interface TestUser {
  userId: string;
  employeeId: string;
  username: string;
  agent: Agent;
}

/** A logged-in HTTP client that handles the session cookie and CSRF header. */
export class Agent {
  private cookies = new Map<string, string>();
  /** Extra headers on every request, e.g. X-Forwarded-For to act as another client address. */
  headers: Record<string, string> = {};

  constructor(private readonly app: NestExpressApplication) {}

  private cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private absorb(res: request.Response) {
    const set = res.headers['set-cookie'] as unknown as string[] | undefined;
    for (const c of set ?? []) {
      const [pair] = c.split(';');
      const [k, ...v] = pair.split('=');
      const value = v.join('=');
      if (/Expires=Thu, 01 Jan 1970/i.test(c) || value === '') this.cookies.delete(k);
      else this.cookies.set(k, value);
    }
    return res;
  }

  async csrf() {
    if (!this.cookies.has('karban_csrf')) {
      this.absorb(
        await request(this.app.getHttpServer())
          .get('/api/auth/csrf')
          .set('Cookie', this.cookieHeader())
          .set(this.headers),
      );
    }
    return this.cookies.get('karban_csrf')!;
  }

  async get(path: string) {
    return this.absorb(
      await request(this.app.getHttpServer()).get(`/api${path}`).set('Cookie', this.cookieHeader()).set(this.headers),
    );
  }

  async send(method: 'post' | 'patch' | 'put' | 'delete', path: string, body?: object, opts: { csrf?: boolean } = {}) {
    const token = await this.csrf();
    const server = request(this.app.getHttpServer());
    let req = server[method](`/api${path}`).set('Cookie', this.cookieHeader()).set(this.headers);
    if (opts.csrf !== false) req = req.set('x-csrf-token', token);
    return this.absorb(await (body ? req.send(body) : req));
  }

  post(path: string, body?: object, opts?: { csrf?: boolean }) {
    return this.send('post', path, body ?? {}, opts);
  }
  patch(path: string, body: object) {
    return this.send('patch', path, body);
  }
  put(path: string, body: object) {
    return this.send('put', path, body);
  }
  delete(path: string) {
    return this.send('delete', path);
  }

  async upload(path: string, field: string, content: Buffer, filename: string) {
    const token = await this.csrf();
    return this.absorb(
      await request(this.app.getHttpServer())
        .post(`/api${path}`)
        .set('Cookie', this.cookieHeader())
        .set(this.headers)
        .set('x-csrf-token', token)
        .attach(field, content, filename),
    );
  }

  async login(username: string, password = PASSWORD) {
    return this.post('/auth/login', { username, password });
  }
}

export class Harness {
  app!: NestExpressApplication;
  prisma!: PrismaService;
  config!: AppConfig;
  email = new FakeEmail({ smtp: { from: 'test@karban.local' }, appUrl: 'http://localhost:3000' } as AppConfig);
  departments: Record<string, string> = {};

  async start() {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailChannel)
      .useValue(this.email)
      .compile();
    this.app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] });
    this.config = this.app.get(APP_CONFIG);
    await configureApp(this.app, this.config);
    await this.app.init();
    this.prisma = this.app.get(PrismaService);
    await this.reset();
    return this;
  }

  async stop() {
    await this.drain();
    await this.app?.close();
  }

  /** Waits for in-process (inline) jobs such as notification deliveries. */
  drain() {
    return this.app.get(QueueService).drain();
  }

  async reset() {
    // Let the previous test's queued jobs finish before their rows disappear.
    await this.drain();
    const tables = await this.prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await this.prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
    await seedReference(this.prisma, { ...this.config, seedAdmin: { username: 'admin', password: PASSWORD } }, false);
    const depts = await this.prisma.department.findMany();
    this.departments = Object.fromEntries(depts.map((d) => [d.code, d.id]));
    this.email.sent = [];
  }

  agent() {
    return new Agent(this.app);
  }

  /** Creates an active user with the given role (and optional manager/team) and logs in. */
  async user(
    username: string,
    opts: {
      role?: string;
      department?: string;
      managerId?: string | null;
      teamId?: string | null;
      fullName?: string;
      email?: string;
    } = {},
  ): Promise<TestUser> {
    const role = await this.prisma.role.findUniqueOrThrow({ where: { code: opts.role ?? RoleCode.EMPLOYEE } });
    const employee = await this.prisma.employee.create({
      data: {
        employeeCode: `T-${username}`,
        fullName: opts.fullName ?? `کاربر ${username}`,
        departmentId: this.departments[opts.department ?? 'SALES'],
        managerId: opts.managerId ?? null,
        teamId: opts.teamId ?? null,
      },
    });
    const user = await this.prisma.user.create({
      data: {
        username,
        email: opts.email ?? `${username}@test.local`,
        passwordHash: await hashPassword(PASSWORD),
        status: UserStatus.ACTIVE,
        roleId: role.id,
        employeeId: employee.id,
      },
    });
    const agent = this.agent();
    const res = await agent.login(username);
    if (res.status !== 200) throw new Error(`login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
    return { userId: user.id, employeeId: employee.id, username, agent };
  }

  async admin(): Promise<TestUser> {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
    const agent = this.agent();
    await agent.login('admin');
    return { userId: u.id, employeeId: u.employeeId, username: 'admin', agent };
  }

  /** Local end-of-day deadline `days` from today. */
  deadline(days: number, hour = 23, minute = 59) {
    return zonedTimeToUtc(addDaysToKey(zonedDateKey(new Date(), TZ), days), hour, minute, TZ).toISOString();
  }

  async notificationsFor(userId: string) {
    return this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  }
}

/** Sales org used by most suites: manager → supervisor → two employees, plus finance. */
export async function salesOrg(h: Harness) {
  const manager = await h.user('sales.manager', { role: RoleCode.DEPARTMENT_MANAGER, fullName: 'علی رضایی' });
  await h.prisma.department.update({ where: { id: h.departments.SALES }, data: { managerId: manager.employeeId } });
  const team = await h.prisma.team.create({ data: { name: 'تیم فروش', departmentId: h.departments.SALES } });
  const supervisor = await h.user('sales.lead', {
    role: RoleCode.SUPERVISOR,
    managerId: manager.employeeId,
    teamId: team.id,
    fullName: 'مسعود یوسفی',
  });
  await h.prisma.team.update({ where: { id: team.id }, data: { leadId: supervisor.employeeId } });
  const rep = await h.user('sales.rep', { managerId: supervisor.employeeId, teamId: team.id, fullName: 'مهدی موسوی' });
  const rep2 = await h.user('sales.rep2', {
    managerId: supervisor.employeeId,
    teamId: team.id,
    fullName: 'سارا محمدی',
  });
  const finManager = await h.user('fin.manager', {
    role: RoleCode.DEPARTMENT_MANAGER,
    department: 'FIN',
    fullName: 'حمید رستمی',
  });
  await h.prisma.department.update({ where: { id: h.departments.FIN }, data: { managerId: finManager.employeeId } });
  const accountant = await h.user('accountant', {
    department: 'FIN',
    managerId: finManager.employeeId,
    fullName: 'لیلا قاسمی',
  });
  // Re-login so team relationships are reflected in fresh contexts.
  for (const u of [manager, supervisor, rep, rep2, finManager, accountant]) await u.agent.login(u.username);
  return { manager, supervisor, rep, rep2, finManager, accountant, teamId: team.id };
}

export function taskBody(h: Harness, ownerId: string, extra: Record<string, unknown> = {}) {
  return {
    title: 'گزارش فروش مهر',
    description: 'تهیه گزارش فروش ماهانه به تفکیک محصول.',
    primaryOwnerId: ownerId,
    deadline: h.deadline(5),
    priority: 'HIGH',
    ...extra,
  };
}
