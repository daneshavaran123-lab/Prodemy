import { Harness, PASSWORD } from './harness';

describe('Authentication & accounts (PRD §14–15, §101–103)', () => {
  const h = new Harness();
  beforeAll(() => h.start());
  afterAll(() => h.stop());
  beforeEach(() => h.reset());

  it('registers a pending account that can log in only after admin approval', async () => {
    const visitor = h.agent();
    const options = await visitor.get('/auth/registration-options');
    expect(options.status).toBe(200);
    expect(options.body.departments).toHaveLength(8);
    expect(options.body.requiresApproval).toBe(true);

    const reg = await visitor.post('/auth/register', {
      username: 'new.user',
      password: 'Secret123',
      fullName: 'نیما خسروی',
      email: 'nima@example.com',
      departmentId: h.departments.CS,
    });
    expect(reg.status).toBe(201);
    expect(reg.body).toEqual({ status: 'PENDING', requiresApproval: true });

    const denied = await visitor.login('new.user', 'Secret123');
    expect(denied.status).toBe(403);
    expect(denied.body.message).toContain('تأیید');

    const admin = await h.admin();
    // Admins are told about the pending registration.
    const notes = await h.notificationsFor(admin.userId);
    expect(notes.map((n) => n.type)).toContain('ACCOUNT_PENDING_APPROVAL');

    const pending = await admin.agent.get('/users?status=PENDING');
    expect(pending.body.items).toHaveLength(1);
    const approve = await admin.agent.post(`/users/${pending.body.items[0].id}/approve`);
    expect(approve.status).toBe(201);
    expect(approve.body.status).toBe('ACTIVE');

    expect((await visitor.login('new.user', 'Secret123')).status).toBe(200);
    const me = await visitor.get('/auth/me');
    expect(me.body.role.code).toBe('employee');
    expect(me.body.employee.departmentId).toBe(h.departments.CS);
  });

  it('rejects weak passwords and duplicate usernames', async () => {
    const v = h.agent();
    const weak = await v.post('/auth/register', {
      username: 'weak.user',
      password: 'password',
      fullName: 'x',
      departmentId: h.departments.HR,
    });
    expect(weak.status).toBe(400);
    await h.user('taken');
    const dup = await v.post('/auth/register', {
      username: 'taken',
      password: 'Secret123',
      fullName: 'x',
      departmentId: h.departments.HR,
    });
    expect(dup.status).toBe(409);
  });

  it('requires a CSRF token on state-changing requests', async () => {
    const u = await h.user('csrf.user');
    const res = await u.agent.post(
      '/auth/change-password',
      { currentPassword: PASSWORD, newPassword: 'Another123' },
      { csrf: false },
    );
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('توکن امنیتی');
  });

  it('logs failed logins and locks the account after repeated failures', async () => {
    const u = await h.user('locked.user');
    const v = h.agent();
    for (let i = 0; i < 5; i++) expect((await v.login('locked.user', 'wrong-pass1')).status).toBe(401);
    const locked = await v.login('locked.user');
    expect(locked.status).toBe(401);
    expect(locked.body.message).toContain('قفل');
    const failures = await h.prisma.auditLog.count({ where: { action: 'LOGIN_FAILED', actorUserId: u.userId } });
    expect(failures).toBeGreaterThanOrEqual(5);
    expect((await v.login('nobody', 'whatever1')).status).toBe(401);
  });

  it('logout revokes the session; password change signs out other sessions', async () => {
    const u = await h.user('session.user');
    const other = h.agent();
    await other.login('session.user');
    expect((await other.get('/auth/me')).status).toBe(200);

    const change = await u.agent.post('/auth/change-password', {
      currentPassword: PASSWORD,
      newPassword: 'Changed123',
    });
    expect(change.status).toBe(204);
    expect((await other.get('/auth/me')).status).toBe(401);
    expect((await u.agent.get('/auth/me')).status).toBe(200);

    await u.agent.post('/auth/logout');
    expect((await u.agent.get('/auth/me')).status).toBe(401);
    expect(await h.prisma.auditLog.count({ where: { action: 'PASSWORD_CHANGED', actorUserId: u.userId } })).toBe(1);
  });

  it('resets a forgotten password via an e-mailed one-time link', async () => {
    await h.user('forgetful', { email: 'forgetful@example.com' });
    const v = h.agent();
    expect((await v.post('/auth/forgot-password', { identifier: 'forgetful@example.com' })).status).toBe(202);
    // Unknown identifiers look identical (no account enumeration).
    expect((await v.post('/auth/forgot-password', { identifier: 'ghost' })).status).toBe(202);
    await h.drain();
    expect(h.email.sent).toHaveLength(1);
    const token = new URL(`http://x${h.email.sent[0].link}`).searchParams.get('token')!;
    expect((await v.post('/auth/reset-password', { token, newPassword: 'Reset12345' })).status).toBe(204);
    expect((await v.post('/auth/reset-password', { token, newPassword: 'Reset12345' })).status).toBe(400);
    expect((await v.login('forgetful', 'Reset12345')).status).toBe(200);
  });

  it('disabling an employee flags their open tasks to the task manager (PRD §86)', async () => {
    const admin = await h.admin();
    const manager = await h.user('mgr', { role: 'department_manager' });
    const emp = await h.user('leaver', { managerId: manager.employeeId });
    await manager.agent.login('mgr');
    const task = await manager.agent.post('/tasks', {
      title: 'وظیفه باز',
      description: 'شرح',
      primaryOwnerId: emp.employeeId,
      deadline: h.deadline(3),
    });
    expect(task.status).toBe(201);
    const res = await admin.agent.post(`/users/${emp.userId}/disable`, { terminated: true });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('DISABLED');
    expect((await emp.agent.get('/auth/me')).status).toBe(401);
    const notes = await h.notificationsFor(manager.userId);
    expect(notes.some((n) => n.type === 'OWNER_DEACTIVATED')).toBe(true);
    // History is retained.
    expect(await h.prisma.taskHistory.count({ where: { taskId: task.body.id } })).toBeGreaterThan(0);
    const dashboard = await manager.agent.get('/dashboard/manager');
    const item = dashboard.body.needsAttention.find((i: any) => i.task.id === task.body.id);
    expect(item.reasons).toContain('OWNER_INACTIVE');
  });

  it('keeps at least one administrator', async () => {
    const admin = await h.admin();
    const employeeRole = await h.prisma.role.findUniqueOrThrow({ where: { code: 'employee' } });
    const res = await admin.agent.patch(`/users/${admin.userId}`, { roleId: employeeRole.id });
    expect(res.status).toBe(400);
  });

  describe('rate limiting (PRD §97, §102)', () => {
    beforeAll(() => {
      process.env.THROTTLE_IN_TESTS = 'true';
    });
    afterAll(() => {
      delete process.env.THROTTLE_IN_TESTS;
    });
    // Each case uses its own client address so counters do not carry over.
    const from = (ip: string) => {
      const agent = h.agent();
      agent.headers = { 'X-Forwarded-For': ip };
      return agent;
    };

    it('limits repeated logins for one username', async () => {
      const v = from('203.0.113.10');
      for (let i = 0; i < 10; i++) expect((await v.login('ghost.user', 'wrong-pass1')).status).toBe(401);
      const limited = await v.login('ghost.user', 'wrong-pass1');
      expect(limited.status).toBe(429);
      expect(limited.body.code).toBe('RATE_LIMITED');
    });

    it('bounds one address rotating usernames, with room for an office behind one NAT', async () => {
      const v = from('203.0.113.11');
      const statuses: number[] = [];
      for (let i = 0; i < 121; i++) statuses.push((await v.login(`probe.${i}`, 'wrong-pass1')).status);
      expect(statuses.slice(0, 120).every((s) => s === 401)).toBe(true);
      expect(statuses[120]).toBe(429);
      expect((await from('203.0.113.12').login('probe.0', 'wrong-pass1')).status).toBe(401);
    });
  });
});
