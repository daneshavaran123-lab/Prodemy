import { TelegramChannel } from '../src/modules/notifications/channels/telegram.channel';
import { Harness, salesOrg, taskBody } from './harness';

describe('Task lifecycle (PRD §17–32, acceptance §111, §113–114)', () => {
  const h = new Harness();
  let org: Awaited<ReturnType<typeof salesOrg>>;

  beforeAll(() => h.start());
  afterAll(() => h.stop());
  beforeEach(async () => {
    await h.reset();
    org = await salesOrg(h);
  });

  it('manager creates a task: history recorded and owner notified (§111)', async () => {
    const res = await org.supervisor.agent.post(
      '/tasks',
      taskBody(h, org.rep.employeeId, { collaboratorIds: [org.rep2.employeeId] }),
    );
    expect(res.status).toBe(201);
    const t = res.body;
    expect(t.code).toMatch(/^KB-\d+$/);
    expect(t.status).toBe('NOT_STARTED');
    expect(t.primaryOwner.id).toBe(org.rep.employeeId);
    expect(t.manager.id).toBe(org.supervisor.employeeId);
    expect(t.department.id).toBe(h.departments.SALES);
    expect(t.collaborators.map((c: any) => c.id)).toEqual([org.rep2.employeeId]);
    expect(t.permissions.canManage).toBe(true);

    const history = await h.prisma.taskHistory.findMany({ where: { taskId: t.id } });
    expect(history.map((x) => x.eventType)).toEqual(expect.arrayContaining(['CREATED', 'ASSIGNED']));
    expect(history.every((x) => x.actorId === org.supervisor.employeeId)).toBe(true);

    const ownerNotes = await h.notificationsFor(org.rep.userId);
    expect(ownerNotes.map((n) => n.type)).toEqual(['TASK_ASSIGNED']);
    expect(ownerNotes[0].link).toBe(`/tasks/${t.id}`);
    expect((await h.notificationsFor(org.rep2.userId)).map((n) => n.type)).toEqual(['COLLABORATOR_ADDED']);
    // Primary owner sees it as theirs; collaborator too.
    const mine = await org.rep2.agent.get('/tasks?scope=mine');
    expect(mine.body.items.map((x: any) => x.id)).toContain(t.id);
  });

  it('requires a deadline and validates dates (§20, §113)', async () => {
    const noDeadline = await org.supervisor.agent.post('/tasks', {
      ...taskBody(h, org.rep.employeeId),
      deadline: undefined,
    });
    expect(noDeadline.status).toBe(400);
    expect(JSON.stringify(noDeadline.body)).toContain('Deadline');
    const past = await org.supervisor.agent.post(
      '/tasks',
      taskBody(h, org.rep.employeeId, { deadline: h.deadline(-2) }),
    );
    expect(past.status).toBe(400);
    const inverted = await org.supervisor.agent.post(
      '/tasks',
      taskBody(h, org.rep.employeeId, { startDate: h.deadline(6), deadline: h.deadline(5) }),
    );
    expect(inverted.status).toBe(400);
    expect(await h.prisma.task.count()).toBe(0);
  });

  it('employees create personal tasks only; their manager supervises them', async () => {
    const self = await org.rep.agent.post('/tasks', taskBody(h, org.rep.employeeId, { title: 'یادداشت شخصی' }));
    expect(self.status).toBe(201);
    expect(self.body.manager.id).toBe(org.supervisor.employeeId);
    const other = await org.rep.agent.post('/tasks', taskBody(h, org.rep2.employeeId));
    expect(other.status).toBe(403);
    // Supervisor cannot assign outside their team; department manager can.
    const outsider = await h.user('other.sales', { managerId: org.manager.employeeId });
    expect((await org.supervisor.agent.post('/tasks', taskBody(h, outsider.employeeId))).status).toBe(403);
    expect((await org.manager.agent.post('/tasks', taskBody(h, outsider.employeeId))).status).toBe(201);
  });

  it('status, progress and blocker flow with manager alerts (§22–23, §29)', async () => {
    const t = (await org.supervisor.agent.post('/tasks', taskBody(h, org.rep.employeeId))).body;

    const progress = await org.rep.agent.post(`/tasks/${t.id}/progress`, { progress: 30, comment: 'شروع شد' });
    expect(progress.status).toBe(200);
    expect(progress.body.status).toBe('IN_PROGRESS');
    expect(progress.body.progress).toBe(30);

    const noBlocker = await org.rep.agent.post(`/tasks/${t.id}/status`, { status: 'BLOCKED' });
    expect(noBlocker.status).toBe(400);

    const blocked = await org.rep.agent.post(`/tasks/${t.id}/status`, {
      status: 'BLOCKED',
      blocker: {
        type: 'WAITING_DEPARTMENT',
        description: 'منتظر تأیید پرداخت',
        blockingDepartmentId: h.departments.FIN,
        expectedResolutionAt: h.deadline(2),
      },
    });
    expect(blocked.status).toBe(200);
    expect(blocked.body.status).toBe('BLOCKED');
    expect(blocked.body.blockers).toHaveLength(1);
    expect(blocked.body.hasOpenBlocker).toBe(true);
    const supervisorNotes = await h.notificationsFor(org.supervisor.userId);
    expect(supervisorNotes.some((n) => n.type === 'TASK_BLOCKED')).toBe(true);
    // The blocking department's manager is told something waits on them.
    expect((await h.notificationsFor(org.finManager.userId)).some((n) => n.type === 'TASK_BLOCKED')).toBe(true);

    const resolved = await org.rep.agent.post(`/blockers/${blocked.body.blockers[0].id}/resolve`, {
      resolutionNote: 'پرداخت تأیید شد',
    });
    expect(resolved.body.status).toBe('IN_PROGRESS');
    expect(resolved.body.hasOpenBlocker).toBe(false);

    const timeline = await org.supervisor.agent.get(`/tasks/${t.id}/timeline`);
    const kinds = timeline.body.map((i: any) => i.eventType ?? 'comment');
    expect(kinds).toEqual(
      expect.arrayContaining([
        'CREATED',
        'PROGRESS_CHANGED',
        'STATUS_CHANGED',
        'BLOCKER_ADDED',
        'BLOCKER_RESOLVED',
        'comment',
      ]),
    );
    const times = timeline.body.map((i: any) => i.createdAt);
    expect([...times].sort()).toEqual(times);
  });

  it('detects concurrent edits with optimistic locking (§91)', async () => {
    const t = (await org.supervisor.agent.post('/tasks', taskBody(h, org.rep.employeeId))).body;
    const first = await org.supervisor.agent.patch(`/tasks/${t.id}`, { version: t.version, title: 'عنوان جدید' });
    expect(first.status).toBe(200);
    const stale = await org.manager.agent.patch(`/tasks/${t.id}`, { version: t.version, priority: 'URGENT' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_VERSION');
  });

  it('records deadline and priority changes with old/new values (§32, §89)', async () => {
    const t = (await org.supervisor.agent.post('/tasks', taskBody(h, org.rep.employeeId))).body;
    const newDeadline = h.deadline(9);
    const res = await org.supervisor.agent.patch(`/tasks/${t.id}`, {
      version: t.version,
      deadline: newDeadline,
      priority: 'URGENT',
      changeNote: 'تغییر برنامه مشتری',
    });
    expect(res.status).toBe(200);
    const h1 = await h.prisma.taskHistory.findFirstOrThrow({ where: { taskId: t.id, eventType: 'DEADLINE_CHANGED' } });
    expect(h1.oldValue).toBe(t.deadline);
    expect((h1.newValue as any).deadline).toBe(newDeadline);
    expect(h1.actorId).toBe(org.supervisor.employeeId);
    const h2 = await h.prisma.taskHistory.findFirstOrThrow({ where: { taskId: t.id, eventType: 'PRIORITY_CHANGED' } });
    expect([h2.oldValue, h2.newValue]).toEqual(['HIGH', 'URGENT']);
    const notes = (await h.notificationsFor(org.rep.userId)).map((n) => n.type);
    expect(notes).toEqual(expect.arrayContaining(['DEADLINE_CHANGED', 'PRIORITY_CHANGED']));
    // The owner may not change the deadline of a task assigned to them.
    expect(
      (await org.rep.agent.patch(`/tasks/${t.id}`, { version: res.body.version, deadline: h.deadline(20) })).status,
    ).toBe(403);
  });

  it('completion with manager review, reopen and acceptance (§24, §85, §90)', async () => {
    const t = (await org.supervisor.agent.post('/tasks', taskBody(h, org.rep.employeeId, { requiresReview: true })))
      .body;
    const done = await org.rep.agent.post(`/tasks/${t.id}/complete`, { note: 'انجام شد' });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('COMPLETED');
    expect(done.body.progress).toBe(100);
    expect(done.body.reviewStatus).toBe('PENDING');
    expect((await h.notificationsFor(org.supervisor.userId)).some((n) => n.type === 'TASK_COMPLETED')).toBe(true);
    // Closed tasks reject work updates until reopened.
    expect((await org.rep.agent.post(`/tasks/${t.id}/progress`, { progress: 50 })).status).toBe(400);
    expect((await org.rep.agent.post(`/tasks/${t.id}/accept`)).status).toBe(403);

    const reopened = await org.supervisor.agent.post(`/tasks/${t.id}/reopen`, { reason: 'جدول دوم ناقص است' });
    expect(reopened.body.status).toBe('IN_PROGRESS');
    expect(reopened.body.completedAt).toBeNull();
    expect((await h.notificationsFor(org.rep.userId)).some((n) => n.type === 'TASK_REOPENED')).toBe(true);

    await org.rep.agent.post(`/tasks/${t.id}/complete`, {});
    const accepted = await org.supervisor.agent.post(`/tasks/${t.id}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.reviewStatus).toBe('ACCEPTED');
    const events = (await h.prisma.taskHistory.findMany({ where: { taskId: t.id } })).map((x) => x.eventType);
    expect(events).toEqual(expect.arrayContaining(['COMPLETED', 'REOPENED', 'ACCEPTED']));
  });

  it('late completion requires a delay reason; "Other" requires a description (§27–28, §114)', async () => {
    const t = (await org.supervisor.agent.post('/tasks', taskBody(h, org.rep.employeeId))).body;
    await h.prisma.task.update({ where: { id: t.id }, data: { deadline: new Date(Date.now() - 2 * 86_400_000) } });

    const view = await org.rep.agent.get(`/tasks/${t.id}`);
    expect(view.body.isOverdue).toBe(true);
    expect(view.body.delayDays).toBe(2);
    expect(view.body.delayReasonRequired).toBe(true);

    const blocked = await org.rep.agent.post(`/tasks/${t.id}/complete`, {});
    expect(blocked.status).toBe(400);
    expect(blocked.body.details.code).toBe('DELAY_REASON_REQUIRED');
    const other = await org.rep.agent.post(`/tasks/${t.id}/delay-reasons`, { reasonType: 'OTHER' });
    expect(other.status).toBe(400);
    const ok = await org.rep.agent.post(`/tasks/${t.id}/complete`, {
      delayReason: { reasonType: 'WAITING_OTHER_DEPARTMENT' },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.delayReasons).toHaveLength(1);
    expect(ok.body.delayReasonRequired).toBe(false);
    expect(ok.body.delayDays).toBe(2);
  });

  it('reassigns the primary owner and keeps exactly one owner (§18)', async () => {
    const t = (
      await org.supervisor.agent.post(
        '/tasks',
        taskBody(h, org.rep.employeeId, { collaboratorIds: [org.rep2.employeeId] }),
      )
    ).body;
    const res = await org.supervisor.agent.post(`/tasks/${t.id}/reassign`, {
      primaryOwnerId: org.rep2.employeeId,
      keepPreviousAsCollaborator: true,
      reason: 'تقسیم مجدد کار',
    });
    expect(res.status).toBe(200);
    expect(res.body.primaryOwner.id).toBe(org.rep2.employeeId);
    expect(res.body.collaborators.map((c: any) => c.id)).toEqual([org.rep.employeeId]);
    const assignments = await h.prisma.taskAssignment.findMany({ where: { taskId: t.id } });
    expect(assignments.filter((a) => a.type === 'PRIMARY')).toHaveLength(1);
    expect((await h.notificationsFor(org.rep2.userId)).some((n) => n.type === 'TASK_REASSIGNED')).toBe(true);
    // Employees cannot reassign.
    expect((await org.rep2.agent.post(`/tasks/${t.id}/reassign`, { primaryOwnerId: org.rep.employeeId })).status).toBe(
      403,
    );
  });

  it('comments with mentions notify immediately; mentions are limited to involved people (§30)', async () => {
    const t = (
      await org.supervisor.agent.post(
        '/tasks',
        taskBody(h, org.rep.employeeId, { collaboratorIds: [org.rep2.employeeId] }),
      )
    ).body;
    const ok = await org.rep.agent.post(`/tasks/${t.id}/comments`, {
      content: 'سارا لطفاً جدول را بفرست',
      mentionIds: [org.rep2.employeeId],
    });
    expect(ok.status).toBe(201);
    expect(ok.body.mentions[0].id).toBe(org.rep2.employeeId);
    const rep2Notes = await h.notificationsFor(org.rep2.userId);
    expect(rep2Notes.find((n) => n.type === 'MENTIONED')?.priority).toBe('CRITICAL');
    // The supervisor (task manager) gets a low-priority comment notification instead.
    expect((await h.notificationsFor(org.supervisor.userId)).find((n) => n.type === 'COMMENT_ADDED')?.priority).toBe(
      'LOW',
    );
    const outsider = await org.rep.agent.post(`/tasks/${t.id}/comments`, {
      content: 'x',
      mentionIds: [org.accountant.employeeId],
    });
    expect(outsider.status).toBe(400);
  });

  it('subtasks: one level, owners from the task, deadlines within the task (§25)', async () => {
    const t = (
      await org.supervisor.agent.post(
        '/tasks',
        taskBody(h, org.rep.employeeId, { collaboratorIds: [org.rep2.employeeId] }),
      )
    ).body;
    const add = await org.rep.agent.post(`/tasks/${t.id}/subtasks`, {
      title: 'جمع‌آوری داده',
      ownerId: org.rep2.employeeId,
      deadline: h.deadline(2),
    });
    expect(add.status).toBe(201);
    expect(add.body.subtasks).toHaveLength(1);
    const sub = add.body.subtasks[0];
    expect(
      (await org.rep.agent.post(`/tasks/${t.id}/subtasks`, { title: 'x', ownerId: org.accountant.employeeId })).status,
    ).toBe(400);
    expect((await org.rep.agent.post(`/tasks/${t.id}/subtasks`, { title: 'x', deadline: h.deadline(30) })).status).toBe(
      400,
    );
    // Subtask owner updates own subtask status; reaching 100% completes it.
    const upd = await org.rep2.agent.patch(`/subtasks/${sub.id}`, { progress: 100 });
    expect(upd.status).toBe(200);
    expect(upd.body.subtasks[0].status).toBe('COMPLETED');
    expect(upd.body.subtaskDoneCount).toBe(1);
    // …but only the lead can rename it.
    expect((await org.rep2.agent.patch(`/subtasks/${sub.id}`, { title: 'نام دیگر' })).status).toBe(403);
    expect((await org.rep.agent.delete(`/subtasks/${sub.id}`)).status).toBe(200);
  });

  it('attachments: allowed types, size limit, secure download (§31, §102)', async () => {
    const t = (await org.supervisor.agent.post('/tasks', taskBody(h, org.rep.employeeId))).body;
    const pdf = Buffer.from('%PDF-1.4\n%test\n');
    const up = await org.rep.agent.upload(`/tasks/${t.id}/attachments`, 'file', pdf, 'گزارش مهر.pdf');
    expect(up.status).toBe(201);
    expect(up.body.fileName).toBe('گزارش مهر.pdf');
    expect(
      (await org.rep.agent.upload(`/tasks/${t.id}/attachments`, 'file', Buffer.from('<script>'), 'x.html')).status,
    ).toBe(400);

    const admin = await h.admin();
    expect((await admin.agent.patch('/settings', { attachmentMaxMb: 1 })).status).toBe(200);
    const big = await org.rep.agent.upload(
      `/tasks/${t.id}/attachments`,
      'file',
      Buffer.alloc(1024 * 1024 + 10),
      'big.zip',
    );
    expect(big.status).toBe(400);
    expect(big.body.message).toContain('۱');

    const dl = await org.supervisor.agent.get(`/attachments/${up.body.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toContain("filename*=UTF-8''");
    expect((await org.accountant.agent.get(`/attachments/${up.body.id}/download`)).status).toBe(403);
    expect((await org.rep2.agent.delete(`/attachments/${up.body.id}`)).status).toBe(403);
    expect((await org.rep.agent.delete(`/attachments/${up.body.id}`)).status).toBe(204);
    const events = (await h.prisma.taskHistory.findMany({ where: { taskId: t.id } })).map((x) => x.eventType);
    expect(events).toEqual(expect.arrayContaining(['ATTACHMENT_ADDED', 'ATTACHMENT_REMOVED']));
  });

  it('search and filters (§39–40)', async () => {
    await org.supervisor.agent.post(
      '/tasks',
      taskBody(h, org.rep.employeeId, { title: 'تماس با مشتری آریا', tags: ['مشتری'] }),
    );
    await org.supervisor.agent.post(
      '/tasks',
      taskBody(h, org.rep2.employeeId, { title: 'گزارش هفتگی', priority: 'LOW' }),
    );
    const q = await org.supervisor.agent.get(`/tasks?q=${encodeURIComponent('آریا')}`);
    expect(q.body.items.map((t: any) => t.title)).toEqual(['تماس با مشتری آریا']);
    const byOwner = await org.supervisor.agent.get(`/tasks?q=${encodeURIComponent('موسوی')}`);
    expect(byOwner.body.total).toBe(1);
    const byTag = await org.supervisor.agent.get(`/tasks?tag=${encodeURIComponent('مشتری')}`);
    expect(byTag.body.total).toBe(1);
    const low = await org.supervisor.agent.get('/tasks?priority=LOW&status=open');
    expect(low.body.total).toBe(1);
    const byCode = await org.supervisor.agent.get(`/tasks?q=${low.body.items[0].code}`);
    expect(byCode.body.items[0].id).toBe(low.body.items[0].id);
  });

  it('recurring task creates a template and links the first instance (§26)', async () => {
    const res = await org.supervisor.agent.post(
      '/tasks',
      taskBody(h, org.rep.employeeId, {
        title: 'گزارش فروش هفتگی',
        recurrence: { frequency: 'WEEKLY', weekdays: [6] },
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.recurrence.frequency).toBe('WEEKLY');
    expect(res.body.recurrence.nextRunAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const list = await org.supervisor.agent.get('/recurrences');
    expect(list.body).toHaveLength(1);
    const paused = await org.supervisor.agent.patch(`/recurrences/${list.body[0].id}`, { active: false });
    expect(paused.body.active).toBe(false);
  });

  it('keeps confidential task details out of Telegram messages', async () => {
    const telegram = h.app.get(TelegramChannel);
    const configured = jest.spyOn(telegram, 'configured', 'get').mockReturnValue(true);
    const send = jest.spyOn(telegram, 'sendMessage').mockResolvedValue();
    try {
      await h.prisma.user.update({ where: { id: org.rep.userId }, data: { telegramChatId: '1001' } });
      const open = await org.supervisor.agent.post(
        '/tasks',
        taskBody(h, org.rep.employeeId, { title: 'پیگیری پیش‌فاکتور' }),
      );
      const secret = await org.supervisor.agent.post(
        '/tasks',
        taskBody(h, org.rep.employeeId, { title: 'مذاکره قرارداد ویژه', confidential: true }),
      );
      expect([open.status, secret.status]).toEqual([201, 201]);
      await h.drain();
      const texts = send.mock.calls.map(([, text]) => text);
      expect(texts).toHaveLength(2);
      expect(texts.some((t) => t.includes('پیگیری پیش‌فاکتور'))).toBe(true);
      expect(texts.some((t) => t.includes('مذاکره قرارداد ویژه'))).toBe(false);
      expect(send.mock.calls.map(([, , link]) => link)).toContain(`/tasks/${secret.body.id}`);
    } finally {
      configured.mockRestore();
      send.mockRestore();
    }
  });
});
