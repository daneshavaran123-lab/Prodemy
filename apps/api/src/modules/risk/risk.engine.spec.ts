import { assessRisk, type RiskInput } from './risk.engine';

const now = new Date('2026-10-20T08:00:00Z');
const day = 24 * 3600 * 1000;

function input(overrides: Partial<RiskInput> = {}): RiskInput {
  return {
    now,
    status: 'IN_PROGRESS',
    priority: 'NORMAL',
    progress: 50,
    startDate: new Date(now.getTime() - 5 * day),
    deadline: new Date(now.getTime() + 5 * day),
    createdAt: new Date(now.getTime() - 5 * day),
    lastProgressAt: now,
    hasOpenBlocker: false,
    workingDaysLeft: 5,
    ownerActiveTasks: 3,
    groupAvgActiveTasks: 3,
    ownerLateRate: null,
    ownerHistorySample: 0,
    ownerOnLeave: false,
    staleDays: 3,
    ...overrides,
  };
}

describe('assessRisk', () => {
  it('returns null for closed tasks', () => {
    expect(assessRisk(input({ status: 'COMPLETED' }))).toBeNull();
    expect(assessRisk(input({ status: 'CANCELLED' }))).toBeNull();
  });

  it('is low for an on-track task', () => {
    const r = assessRisk(input())!;
    expect(r.level).toBe('LOW');
    expect(r.factors).toHaveLength(0);
  });

  it('matches the PRD §53 example as high risk with explanations', () => {
    // 25% progress, 1 day remaining, high priority, 6 active tasks.
    const r = assessRisk(
      input({
        progress: 25,
        priority: 'HIGH',
        deadline: new Date(now.getTime() + 1 * day),
        startDate: new Date(now.getTime() - 9 * day),
        createdAt: new Date(now.getTime() - 9 * day),
        workingDaysLeft: 1,
        ownerActiveTasks: 6,
        groupAvgActiveTasks: 3,
      }),
    )!;
    expect(r.level).toBe('HIGH');
    const codes = r.factors.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(['BEHIND_SCHEDULE', 'LITTLE_TIME', 'PRIORITY', 'WORKLOAD']));
    expect(r.factors.every((f) => f.label.length > 0)).toBe(true);
  });

  it('marks overdue tasks high', () => {
    const r = assessRisk(input({ deadline: new Date(now.getTime() - 2 * day) }))!;
    expect(r.level).toBe('HIGH');
    expect(r.factors[0].code).toBe('OVERDUE');
  });

  it('accounts for blockers and leave without blaming the owner', () => {
    const r = assessRisk(input({ hasOpenBlocker: true, ownerOnLeave: true }))!;
    expect(r.level).toBe('MEDIUM');
    expect(r.factors.map((f) => f.code)).toEqual(['BLOCKED', 'OWNER_ON_LEAVE']);
  });
});
