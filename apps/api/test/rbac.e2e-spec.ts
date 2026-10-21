import { RoleCode } from '@karban/shared';
import { Harness, salesOrg, taskBody } from './harness';

describe('RBAC & department isolation (PRD §12, §94, acceptance §112)', () => {
  const h = new Harness();
  let org: Awaited<ReturnType<typeof salesOrg>>;
  let financeTask: any;
  let salesTask: any;

  beforeAll(async () => {
    await h.start();
    org = await salesOrg(h);
    financeTask = (
      await org.finManager.agent.post(
        '/tasks',
        taskBody(h, org.accountant.employeeId, { title: 'تطبیق حساب‌های بانکی' }),
      )
    ).body;
    salesTask = (await org.supervisor.agent.post('/tasks', taskBody(h, org.rep.employeeId))).body;
  });
  afterAll(() => h.stop());

  it('finance tasks are confidential by default', () => {
    expect(financeTask.confidential).toBe(true);
    expect(salesTask.confidential).toBe(false);
  });

  it('sales manager is denied a finance task — backend returns 403 and logs it (§112, §94)', async () => {
    const before = await h.prisma.auditLog.count({
      where: { action: 'ACCESS_DENIED', actorUserId: org.manager.userId },
    });
    const res = await org.manager.agent.get(`/tasks/${financeTask.id}`);
    expect(res.status).toBe(403);
    expect((await org.manager.agent.get(`/tasks/${financeTask.id}/timeline`)).status).toBe(403);
    expect((await org.manager.agent.post(`/tasks/${financeTask.id}/comments`, { content: 'x' })).status).toBe(403);
    const after = await h.prisma.auditLog.count({
      where: { action: 'ACCESS_DENIED', actorUserId: org.manager.userId },
    });
    expect(after).toBeGreaterThan(before);
    // It never appears in lists or search either.
    const list = await org.manager.agent.get(`/tasks?q=${encodeURIComponent('تطبیق')}`);
    expect(list.body.total).toBe(0);
  });

  it('visibility by role: employee → own, supervisor → team, manager → department, CEO → all', async () => {
    const ids = async (u: { agent: any }) =>
      (await u.agent.get('/tasks?pageSize=100')).body.items.map((t: any) => t.id);
    const ceo = await h.user('ceo', { role: RoleCode.CEO, department: 'MGMT' });
    expect(await ids(org.rep)).toEqual([salesTask.id]);
    expect(await ids(org.rep2)).toEqual([]);
    expect(await ids(org.supervisor)).toEqual([salesTask.id]);
    expect(await ids(org.manager)).toEqual([salesTask.id]);
    expect(await ids(org.finManager)).toEqual([financeTask.id]);
    expect((await ids(ceo)).sort()).toEqual([salesTask.id, financeTask.id].sort());
    expect((await ceo.agent.get(`/tasks/${financeTask.id}`)).status).toBe(200);
  });

  it('team scope never exposes confidential tasks of team members', async () => {
    const t = (
      await org.manager.agent.post('/tasks', taskBody(h, org.rep2.employeeId, { title: 'محرمانه', confidential: true }))
    ).body;
    expect((await org.supervisor.agent.get(`/tasks/${t.id}`)).status).toBe(403);
    expect((await org.manager.agent.get(`/tasks/${t.id}`)).status).toBe(200);
    expect((await org.rep2.agent.get(`/tasks/${t.id}`)).status).toBe(200);
  });

  it('HR sees raw performance metrics but no task content (§108)', async () => {
    const hr = await h.user('hr', { role: RoleCode.HR, department: 'HR' });
    expect((await hr.agent.get(`/tasks/${salesTask.id}`)).status).toBe(403);
    expect((await hr.agent.get('/tasks')).body.total).toBe(0);
    const metrics = await hr.agent.get('/performance/metrics');
    expect(metrics.status).toBe(200);
    const row = metrics.body.find((r: any) => r.employee.id === org.rep.employeeId);
    expect(row).toMatchObject({ activeWorkload: 1 });
    expect(JSON.stringify(metrics.body)).not.toContain('گزارش فروش مهر');
    const exported = await hr.agent.get('/performance/export?format=csv');
    expect(exported.status).toBe(200);
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(await h.prisma.auditLog.count({ where: { action: 'DATA_EXPORTED', actorUserId: hr.userId } })).toBe(1);
    expect((await org.manager.agent.get('/performance/metrics')).status).toBe(403);
  });

  it('admin manages the system but has no implicit task access', async () => {
    const admin = await h.admin();
    expect((await admin.agent.get(`/tasks/${salesTask.id}`)).status).toBe(403);
    expect((await admin.agent.get('/users')).status).toBe(200);
    expect((await admin.agent.get('/audit-logs')).status).toBe(200);
    expect((await org.manager.agent.get('/audit-logs')).status).toBe(403);
    expect((await org.manager.agent.patch('/settings', { staleTaskDays: 5 })).status).toBe(403);
    expect((await org.rep.agent.get('/integrations/status')).status).toBe(403);
  });

  it('role permissions are data: granting a permission takes effect immediately', async () => {
    const admin = await h.admin();
    const roles = (await admin.agent.get('/roles')).body;
    const employee = roles.find((r: any) => r.code === 'employee');
    const res = await admin.agent.patch(`/roles/${employee.id}`, {
      permissions: [...employee.permissions, 'task.view.department'],
    });
    expect(res.status).toBe(200);
    expect(await h.prisma.auditLog.count({ where: { action: 'PERMISSION_CHANGED' } })).toBe(1);
    expect((await org.rep2.agent.get(`/tasks/${salesTask.id}`)).status).toBe(200);
    await admin.agent.patch(`/roles/${employee.id}`, { permissions: employee.permissions });
    expect((await org.rep2.agent.get(`/tasks/${salesTask.id}`)).status).toBe(403);
  });

  it('department and organization dashboards respect report scope', async () => {
    expect((await org.manager.agent.get(`/dashboard/department/${h.departments.SALES}`)).status).toBe(200);
    expect((await org.manager.agent.get(`/dashboard/department/${h.departments.FIN}`)).status).toBe(403);
    expect((await org.manager.agent.get('/dashboard/organization')).status).toBe(403);
    expect((await org.rep.agent.get(`/reports/summary?scope=employee&id=${org.rep2.employeeId}`)).status).toBe(403);
    expect((await org.supervisor.agent.get(`/reports/summary?scope=employee&id=${org.rep2.employeeId}`)).status).toBe(
      200,
    );
  });
});
