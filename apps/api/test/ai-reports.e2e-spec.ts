import { RoleCode, zonedDateKey } from '@karban/shared';
import { AiService } from '../src/modules/ai/ai.service';
import type { AiProvider, CompletionRequest } from '../src/modules/ai/ai.provider';
import { Harness, TZ, salesOrg, taskBody } from './harness';

class FakeProvider implements AiProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  readonly enabled = true;
  requests: CompletionRequest[] = [];
  constructor(private readonly reply: (req: CompletionRequest) => string) {}
  async complete(req: CompletionRequest) {
    this.requests.push(req);
    return { text: this.reply(req), model: this.model };
  }
}

class FailingProvider implements AiProvider {
  readonly name = 'failing';
  readonly model = 'x';
  readonly enabled = true;
  async complete(): Promise<never> {
    throw new Error('provider timeout');
  }
}

describe('AI assistance (PRD §48–59, acceptance §115) and reports (§116–117)', () => {
  const h = new Harness();
  let org: Awaited<ReturnType<typeof salesOrg>>;
  let ai: AiService;

  beforeAll(async () => {
    await h.start();
    ai = h.app.get(AiService);
  });
  afterAll(() => h.stop());
  beforeEach(async () => {
    await h.reset();
    org = await salesOrg(h);
    ai.setProvider({ name: 'disabled', model: null, enabled: false, complete: () => Promise.reject(new Error('off')) });
  });

  it('parses natural language into a draft without creating any task (§49, §115)', async () => {
    const res = await org.supervisor.agent.post('/ai/parse-task', {
      text: 'گزارش فروش مهر را مهدی تا پنجشنبه آماده کند و اولویت بالا باشد.',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'گزارش فروش مهر', priority: 'HIGH', source: 'heuristic' });
    expect(res.body.primaryOwner.id).toBe(org.rep.employeeId);
    expect(res.body.deadline).toBeTruthy();
    expect(await h.prisma.task.count()).toBe(0);
    // Only after the user confirms (normal create endpoint) does the task exist.
    const created = await org.supervisor.agent.post('/tasks', {
      title: res.body.title,
      description: res.body.description,
      primaryOwnerId: res.body.primaryOwner.id,
      deadline: res.body.deadline,
      priority: res.body.priority,
    });
    expect(created.status).toBe(201);
    expect(await h.prisma.task.count()).toBe(1);
    expect(await h.prisma.aIInsight.count({ where: { insightType: 'TASK_PARSE' } })).toBe(1);
  });

  it('only offers assignees the requester may assign to', async () => {
    const res = await org.rep.agent.post('/ai/parse-task', { text: 'سارا تا فردا فایل را بفرستد' });
    expect(res.status).toBe(200);
    expect(res.body.primaryOwner).toBeNull();
  });

  it('uses the AI provider when available, with guardrails and validated output', async () => {
    const provider = new FakeProvider(() =>
      JSON.stringify({
        title: 'آماده‌سازی گزارش فروش مهر',
        description: 'گزارش ماهانه',
        assigneeKey: 'e999',
        assigneeName: 'ناشناس',
        deadlineDate: '2000-01-01',
        priority: 'SUPER',
        tags: ['فروش'],
        confidence: 0.9,
      }),
    );
    ai.setProvider(provider);
    const res = await org.supervisor.agent.post('/ai/parse-task', { text: 'گزارش فروش مهر را آماده کن' });
    expect(res.body.source).toBe('ai');
    expect(res.body.title).toBe('آماده‌سازی گزارش فروش مهر');
    // Invalid fields from the model are rejected, not trusted.
    expect(res.body.primaryOwner).toBeNull();
    expect(res.body.deadline).toBeNull();
    expect(res.body.priority).toBe('NORMAL');
    expect(res.body.warnings.length).toBeGreaterThanOrEqual(2);
    expect(provider.requests[0].system).toContain('Never rate, score, rank or judge');
    // Data minimization: only assignable people are sent, never the full directory.
    const payload = JSON.parse(provider.requests[0].user);
    expect(payload.candidates.map((c: any) => c.name).sort()).toEqual(
      ['مسعود یوسفی', 'مهدی موسوی', 'سارا محمدی'].sort(),
    );
  });

  it('falls back to deterministic logic when the provider fails, and logs the error (§59, §92)', async () => {
    ai.setProvider(new FailingProvider());
    const res = await org.supervisor.agent.post('/ai/parse-task', { text: 'مهدی تا فردا پیش‌فاکتور را بفرستد' });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('heuristic');
    expect(res.body.warnings[0]).toContain('موقتاً');
    expect(await h.prisma.auditLog.count({ where: { action: 'AI_ERROR' } })).toBe(1);
    const status = await org.supervisor.agent.get('/ai/status');
    expect(status.body.available).toBe(false);
    // Core task management is unaffected.
    expect((await org.supervisor.agent.post('/tasks', taskBody(h, org.rep.employeeId))).status).toBe(201);
    const summary = await org.supervisor.agent.get('/ai/summary/manager');
    expect(summary.status).toBe(200);
    expect(summary.body.text).toContain('وظیفه فعال');
    expect(summary.body.aiText).toBeNull();
  });

  it('manager summary follows the PRD wording and keeps confidential titles away from AI (§51, §104)', async () => {
    await org.supervisor.agent.post('/tasks', taskBody(h, org.rep.employeeId));
    const secret = (
      await org.manager.agent.post(
        '/tasks',
        taskBody(h, org.rep2.employeeId, { title: 'مذاکره محرمانه', confidential: true }),
      )
    ).body;
    // Overdue, so it is listed under "needs attention" in the AI context.
    await h.prisma.task.update({ where: { id: secret.id }, data: { deadline: new Date(Date.now() - 86_400_000) } });
    const provider = new FakeProvider(() => 'خلاصه آزمایشی');
    ai.setProvider(provider);
    const res = await org.manager.agent.get('/ai/summary/manager');
    expect(res.body.text).toMatch(/فروش و بازاریابی .* وظیفه فعال دارد؛ .* وظیفه عقب‌افتاده، .* وظیفه در معرض تأخیر/);
    expect(res.body.aiText).toBe('خلاصه آزمایشی');
    expect(provider.requests[0].user).not.toContain('مذاکره محرمانه');
    expect(provider.requests[0].user).toContain('[محرمانه]');
  });

  it('daily employee summary and executive summary', async () => {
    await org.supervisor.agent.post('/tasks', taskBody(h, org.rep.employeeId, { deadline: h.deadline(0) }));
    const daily = await org.rep.agent.get('/ai/summary/daily');
    expect(daily.body.stats.dueToday).toBe(1);
    expect(daily.body.text).toContain('امروز');
    const ceo = await h.user('ceo', { role: RoleCode.CEO, department: 'MGMT' });
    const exec = await ceo.agent.get('/ai/summary/executive?period=month');
    expect(exec.status).toBe(200);
    expect(exec.body.text).toContain('سازمان');
    expect((await org.manager.agent.get('/ai/summary/executive')).status).toBe(403);
  });

  it('priority suggestion and workload assistant never act on their own (§54–55)', async () => {
    const s = await org.supervisor.agent.post('/ai/suggest-priority', {
      title: 'رفع قطعی فوری سرور',
      deadline: h.deadline(0),
    });
    expect(s.body.priority).toBe('URGENT');
    expect(s.body.reasons.length).toBeGreaterThan(0);
    for (let i = 0; i < 6; i++)
      await org.supervisor.agent.post('/tasks', taskBody(h, org.rep.employeeId, { title: `کار ${i}` }));
    const w = await org.supervisor.agent.get('/ai/workload');
    expect(w.body.overloaded.map((r: any) => r.employee.id)).toContain(org.rep.employeeId);
    expect(w.body.notes.at(-1)).toContain('خودکار');
    const owners = await h.prisma.task.groupBy({ by: ['primaryOwnerId'], _count: true });
    expect(owners).toHaveLength(1);
  });

  it('dashboards: employee sections and manager needs-attention (§33–35)', async () => {
    const overdue = (
      await org.supervisor.agent.post(
        '/tasks',
        taskBody(h, org.rep.employeeId, { title: 'عقب‌افتاده', priority: 'URGENT' }),
      )
    ).body;
    await h.prisma.task.update({
      where: { id: overdue.id },
      data: { deadline: new Date(Date.now() - 4 * 86_400_000) },
    });
    await org.supervisor.agent.post(
      '/tasks',
      taskBody(h, org.rep.employeeId, { title: 'امروز', deadline: h.deadline(0) }),
    );

    const emp = await org.rep.agent.get('/dashboard/employee');
    expect(emp.body.summary).toMatchObject({ active: 2, overdue: 1, dueToday: 1, pendingDelayReasons: 1 });
    expect(emp.body.overdue[0].title).toBe('عقب‌افتاده');

    const mgr = await org.supervisor.agent.get('/dashboard/manager');
    expect(mgr.body.scope.type).toBe('team');
    const item = mgr.body.needsAttention.find((i: any) => i.task.id === overdue.id);
    expect(item.reasons).toEqual(expect.arrayContaining(['CRITICAL_OVERDUE', 'DELAY_REASON_MISSING']));
    expect(mgr.body.workload.find((w: any) => w.employee.id === org.rep.employeeId).active).toBe(2);

    const dept = await org.manager.agent.get(`/dashboard/department/${h.departments.SALES}`);
    expect(dept.body.kpis.overdue).toBe(1);
    expect(dept.body.teams).toHaveLength(1);
    expect(dept.body.trend).toHaveLength(12);
  });

  it('organization dashboard compares departments with relative KPIs (§37–38)', async () => {
    await org.supervisor.agent.post('/tasks', taskBody(h, org.rep.employeeId));
    await org.finManager.agent.post('/tasks', taskBody(h, org.accountant.employeeId));
    const ceo = await h.user('ceo', { role: RoleCode.CEO, department: 'MGMT' });
    const res = await ceo.agent.get('/dashboard/organization');
    expect(res.status).toBe(200);
    const sales = res.body.departments.find((d: any) => d.department.id === h.departments.SALES);
    expect(sales.kpis.headcount).toBe(4);
    expect(sales.kpis.tasksPerEmployee).toBe(0.3);
    expect(res.body.departments).toHaveLength(8);
  });

  it('exports tasks and reports as Excel/CSV with an audit entry (§117)', async () => {
    await org.supervisor.agent.post('/tasks', taskBody(h, org.rep.employeeId, { title: '=HYPERLINK("x")' }));
    const csv = await org.supervisor.agent.get('/reports/export/tasks?format=csv');
    expect(csv.status).toBe(200);
    expect(csv.text.charCodeAt(0)).toBe(0xfeff);
    expect(csv.text).toContain(`'=HYPERLINK`);
    const xlsx = await org.manager.agent.get(
      `/reports/export/summary?scope=department&id=${h.departments.SALES}&format=xlsx`,
    );
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(await h.prisma.auditLog.count({ where: { action: 'DATA_EXPORTED' } })).toBe(2);
    const report = await org.manager.agent.get(`/reports/summary?scope=department&id=${h.departments.SALES}`);
    expect(report.body.breakdown.length).toBe(4);
    expect(report.body.period.to.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
    expect(zonedDateKey(new Date(report.body.period.to), TZ)).toBeTruthy();
  });
});
