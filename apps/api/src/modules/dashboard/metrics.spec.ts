import { computeKpis, computeWorkload, weeklyTrend, type MetricTask } from './metrics';

const now = new Date('2026-10-20T08:00:00Z');
const day = 86_400_000;
let seq = 0;
function task(o: Partial<MetricTask>): MetricTask {
  seq++;
  return {
    id: `t${seq}`,
    status: 'IN_PROGRESS',
    priority: 'NORMAL',
    deadline: new Date(now.getTime() + 2 * day),
    createdAt: new Date(now.getTime() - 5 * day),
    completedAt: null,
    cancelledAt: null,
    primaryOwnerId: 'a',
    departmentId: 'd',
    riskLevel: 'LOW',
    reviewStatus: 'NONE',
    hasOpenBlocker: false,
    ...o,
  };
}

describe('computeKpis', () => {
  const period = { from: new Date(now.getTime() - 30 * day), to: now };

  it('computes relative rates', () => {
    const tasks = [
      task({}),
      task({ deadline: new Date(now.getTime() - 2 * day) }), // overdue 2 days
      task({ status: 'BLOCKED' }),
      task({ riskLevel: 'HIGH' }),
      task({
        status: 'COMPLETED',
        deadline: new Date(now.getTime() - 3 * day),
        completedAt: new Date(now.getTime() - 4 * day),
      }),
      task({
        status: 'COMPLETED',
        deadline: new Date(now.getTime() - 3 * day),
        completedAt: new Date(now.getTime() - 1 * day),
      }), // 2 days late
    ];
    const k = computeKpis(tasks, 2, now, period);
    expect(k.active).toBe(4);
    expect(k.completed).toBe(2);
    expect(k.onTimeRate).toBe(0.5);
    expect(k.overdue).toBe(1);
    expect(k.overdueRate).toBe(0.25);
    expect(k.blocked).toBe(1);
    expect(k.atRisk).toBe(1);
    expect(k.tasksPerEmployee).toBe(2);
    expect(k.avgDelayDays).toBe(2);
    // Due in period: overdue task + two completed → 2/3 completed.
    expect(k.completionRate).toBeCloseTo(2 / 3);
  });

  it('handles empty sets', () => {
    const k = computeKpis([], 0, now, period);
    expect(k.onTimeRate).toBeNull();
    expect(k.tasksPerEmployee).toBeNull();
  });
});

describe('computeWorkload', () => {
  it('flags overloaded and under-utilized people relative to the group', () => {
    const employees = ['a', 'b', 'c'].map((id) => ({
      id,
      fullName: id,
      jobTitle: null,
      departmentId: 'd',
      departmentName: 'D',
      onLeave: false,
    }));
    const tasks = [
      ...Array.from({ length: 6 }, () => task({ primaryOwnerId: 'a', priority: 'HIGH' })),
      task({ primaryOwnerId: 'b' }),
      task({ primaryOwnerId: 'b' }),
    ];
    const rows = computeWorkload(employees, tasks, now, { overload: 1.5, underutilized: 0.5 });
    const byId = Object.fromEntries(rows.map((r) => [r.employee.id, r]));
    expect(byId.a.state).toBe('OVERLOADED');
    expect(byId.c.state).toBe('UNDERUTILIZED');
    expect(byId.b.state).toBe('BALANCED');
  });
});

describe('weeklyTrend', () => {
  it('returns one bucket per week starting Saturday', () => {
    const points = weeklyTrend([task({ createdAt: now })], 4, now, 'Asia/Tehran');
    expect(points).toHaveLength(4);
    expect(points[3].created).toBe(1);
    // 2026-10-17 is a Saturday; Tehran midnight = 20:30Z the day before.
    expect(points[3].periodStart).toBe('2026-10-16T20:30:00.000Z');
  });
});
