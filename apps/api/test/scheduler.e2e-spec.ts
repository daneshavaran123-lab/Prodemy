import { addDaysToKey, zonedDateKey, zonedTimeToUtc } from '@karban/shared';
import { DeadlineScanner } from '../src/modules/scheduler/deadline.scanner';
import { RecurrenceRunner } from '../src/modules/scheduler/recurrence.runner';
import { SchedulerService } from '../src/modules/scheduler/scheduler.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { RiskService } from '../src/modules/risk/risk.service';
import { Harness, TZ, salesOrg, taskBody } from './harness';

const DAY = 86_400_000;

describe('Scheduler: reminders, overdue, recurrence, digest (PRD §26–27, §44, §47, §80–81)', () => {
  const h = new Harness();
  let org: Awaited<ReturnType<typeof salesOrg>>;
  let scanner: DeadlineScanner;

  beforeAll(async () => {
    await h.start();
    scanner = h.app.get(DeadlineScanner);
  });
  afterAll(() => h.stop());
  beforeEach(async () => {
    await h.reset();
    org = await salesOrg(h);
  });

  it('marks overdue tasks once, asks for a delay reason and alerts the manager (§114, §81)', async () => {
    const t = (await org.supervisor.agent.post('/tasks', taskBody(h, org.rep.employeeId))).body;
    await h.prisma.task.update({ where: { id: t.id }, data: { deadline: new Date(Date.now() - 3600_000) } });

    const first = await scanner.scan();
    expect(first.overdue).toBe(1);
    const again = await scanner.scan();
    expect(again.overdue).toBe(0);

    const task = await h.prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(task.overdueAt).not.toBeNull();
    const history = await h.prisma.taskHistory.findMany({ where: { taskId: t.id, eventType: 'MARKED_OVERDUE' } });
    expect(history).toHaveLength(1);
    expect(history[0].actorId).toBeNull();

    const ownerTypes = (await h.notificationsFor(org.rep.userId)).map((n) => n.type);
    expect(ownerTypes.filter((x) => x === 'DELAY_REASON_REQUIRED')).toHaveLength(1);
    const managerTypes = (await h.notificationsFor(org.supervisor.userId)).map((n) => n.type);
    expect(managerTypes.filter((x) => x === 'TASK_OVERDUE')).toHaveLength(1);

    const view = await org.rep.agent.get(`/tasks/${t.id}`);
    expect(view.body.isOverdue).toBe(true);
    expect(view.body.delayReasonRequired).toBe(true);
    // Extending the deadline clears the overdue marker so a future miss is detected again.
    const ext = await org.supervisor.agent.patch(`/tasks/${t.id}`, {
      version: view.body.version,
      deadline: h.deadline(2),
    });
    expect(ext.body.overdueAt).toBeNull();
    expect(ext.body.isOverdue).toBe(false);
  });

  it('sends reminders on the configured offsets only, without duplicates (§44)', async () => {
    const t = (await org.supervisor.agent.post('/tasks', taskBody(h, org.rep.employeeId))).body;
    const now = new Date();
    const today = zonedDateKey(now, TZ);
    // Created long ago so "approaching" reminders apply.
    await h.prisma.task.update({ where: { id: t.id }, data: { createdAt: new Date(now.getTime() - 10 * DAY) } });

    const at = async (deadlineInDays: number) => {
      await h.prisma.task.update({
        where: { id: t.id },
        data: { deadline: zonedTimeToUtc(addDaysToKey(today, deadlineInDays), 23, 59, TZ), overdueAt: null },
      });
      return scanner.sendReminders(now);
    };
    expect(await at(3)).toBe(1); // −3 days
    expect(await at(3)).toBe(0); // deduplicated
    expect(await at(2)).toBe(0); // −2 is not an offset
    expect(await at(1)).toBe(1); // −1 day
    expect(await at(0)).toBe(1); // deadline day
    const types = (await h.notificationsFor(org.rep.userId)).map((n) => n.type);
    expect(types.filter((x) => x === 'DEADLINE_APPROACHING')).toHaveLength(2);
    expect(types).toContain('DEADLINE_REACHED');

    // +1 day after the deadline: owner and manager both reminded.
    expect(await at(-1)).toBe(2);
  });

  it('creates recurring instances idempotently from the template (§26)', async () => {
    const created = await org.supervisor.agent.post(
      '/tasks',
      taskBody(h, org.rep.employeeId, {
        title: 'گزارش فروش روزانه',
        deadline: h.deadline(0),
        recurrence: { frequency: 'CUSTOM', interval: 1 },
      }),
    );
    expect(created.status).toBe(201);
    const rule = await h.prisma.recurrenceRule.findFirstOrThrow();
    const today = zonedDateKey(new Date(), TZ);
    expect(rule.nextOccurrence).toBe(addDaysToKey(today, 1));

    const runner = h.app.get(RecurrenceRunner);
    expect(await runner.run(new Date())).toBe(0);
    const tomorrow = new Date(Date.now() + DAY);
    expect(await runner.run(tomorrow)).toBe(1);
    expect(await runner.run(tomorrow)).toBe(0);
    const instances = await h.prisma.task.findMany({ where: { recurrenceId: rule.id }, orderBy: { number: 'asc' } });
    expect(instances.map((i) => i.recurrenceOccurrence)).toEqual([today, addDaysToKey(today, 1)]);
    expect(instances[1].title).toBe('گزارش فروش روزانه');
    expect(instances[1].primaryOwnerId).toBe(org.rep.employeeId);
    expect(zonedDateKey(instances[1].deadline, TZ)).toBe(addDaysToKey(today, 1));
    expect((await h.notificationsFor(org.rep.userId)).filter((n) => n.type === 'TASK_ASSIGNED')).toHaveLength(2);
  });

  it('pauses a recurrence whose owner left and alerts the manager', async () => {
    await org.supervisor.agent.post(
      '/tasks',
      taskBody(h, org.rep.employeeId, { deadline: h.deadline(0), recurrence: { frequency: 'CUSTOM', interval: 1 } }),
    );
    const admin = await h.admin();
    await admin.agent.post(`/users/${org.rep.userId}/disable`, {});
    await h.app.get(RecurrenceRunner).run(new Date(Date.now() + DAY));
    const rule = await h.prisma.recurrenceRule.findFirstOrThrow();
    expect(rule.active).toBe(false);
    expect((await h.notificationsFor(org.supervisor.userId)).some((n) => n.type === 'OWNER_DEACTIVATED')).toBe(true);
  });

  it('batches low-priority activity into one digest e-mail; critical items go immediately (§47)', async () => {
    const t = (await org.supervisor.agent.post('/tasks', taskBody(h, org.rep.employeeId))).body;
    await h.drain();
    h.email.sent = [];
    await org.rep2.agent.login('sales.rep2');
    // Two plain comments (LOW for the owner) and one mention (CRITICAL).
    await org.supervisor.agent.post(`/tasks/${t.id}/comments`, { content: 'نظر اول' });
    await org.supervisor.agent.post(`/tasks/${t.id}/comments`, { content: 'نظر دوم' });
    await org.supervisor.agent.post(`/tasks/${t.id}/comments`, {
      content: 'مهدی فوری ببین',
      mentionIds: [org.rep.employeeId],
    });
    await h.drain();
    const immediate = h.email.sent.filter((m) => m.to === 'sales.rep@test.local');
    expect(immediate).toHaveLength(1);
    expect(immediate[0].subject).toContain('اشاره');

    h.email.sent = [];
    const sent = await h.app.get(NotificationsService).sendDigests();
    expect(sent).toBe(1);
    expect(h.email.sent).toHaveLength(1);
    expect(h.email.sent[0].text).toContain('نظر جدید');
    expect(await h.app.get(NotificationsService).sendDigests()).toBe(0);
  });

  it('records failed deliveries while keeping the in-app notification (§93)', async () => {
    const send = jest.spyOn(h.email, 'send').mockRejectedValueOnce(new Error('SMTP down'));
    await org.supervisor.agent.post('/tasks', taskBody(h, org.rep.employeeId));
    await h.drain();
    send.mockRestore();
    const delivery = await h.prisma.notificationDelivery.findFirstOrThrow({
      where: { channel: 'EMAIL', notification: { userId: org.rep.userId } },
    });
    expect(delivery.status).toBe('FAILED');
    expect(delivery.error).toContain('SMTP down');
    expect(await h.prisma.auditLog.count({ where: { action: 'NOTIFICATION_FAILURE' } })).toBe(1);
    const inApp = await org.rep.agent.get('/notifications');
    expect(inApp.body.items[0].type).toBe('TASK_ASSIGNED');
    expect((await org.rep.agent.get('/notifications/unread-count')).body.count).toBe(1);
    await org.rep.agent.post('/notifications/read-all');
    expect((await org.rep.agent.get('/notifications/unread-count')).body.count).toBe(0);
  });

  it('weekly summaries reach managers; risk is refreshed for open tasks', async () => {
    const t = (await org.supervisor.agent.post('/tasks', taskBody(h, org.rep.employeeId, { deadline: h.deadline(1) })))
      .body;
    await h.prisma.task.update({
      where: { id: t.id },
      data: { startDate: new Date(Date.now() - 9 * DAY), createdAt: new Date(Date.now() - 9 * DAY) },
    });
    await h.app.get(RiskService).refresh();
    const view = await org.supervisor.agent.get(`/tasks/${t.id}`);
    expect(view.body.risk.level).toBe('HIGH');
    expect(view.body.risk.factors.map((f: any) => f.code)).toContain('BEHIND_SCHEDULE');

    await h.app.get(SchedulerService).weeklySummaries();
    const notes = await h.notificationsFor(org.manager.userId);
    const weekly = notes.find((n) => n.type === 'WEEKLY_SUMMARY');
    expect(weekly?.body).toContain('وظیفه فعال');
  });
});
