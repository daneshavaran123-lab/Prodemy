import type { RiskAssessment, RiskFactor, RiskLevel, TaskPriority, TaskStatus } from '@karban/shared';
import { DAY_MS, delayDays, isOpenStatus, toPersianDigits } from '@karban/shared';

export interface RiskInput {
  now: Date;
  status: TaskStatus;
  priority: TaskPriority;
  progress: number;
  startDate: Date;
  deadline: Date;
  createdAt: Date;
  lastProgressAt: Date;
  hasOpenBlocker: boolean;
  workingDaysLeft: number;
  ownerActiveTasks: number;
  /** Mean active tasks per person in the owner's department (comparison group). */
  groupAvgActiveTasks: number;
  /** Share of the owner's recent completed tasks that finished late (null = no history). */
  ownerLateRate: number | null;
  ownerHistorySample: number;
  ownerOnLeave: boolean;
  staleDays: number;
}

export const RISK_THRESHOLDS = { high: 50, medium: 25 } as const;

const fa = (n: number) => toPersianDigits(Math.round(n));

/**
 * Explainable, deterministic delay-risk scoring (PRD §52–53).
 * Each factor adds points and a human-readable reason; the level follows the total.
 * It runs without any external AI so risk detection survives provider outages (PRD §59).
 * Factors describe the task's situation only — never a judgement of the person (PRD §58).
 */
export function assessRisk(input: RiskInput): RiskAssessment | null {
  if (!isOpenStatus(input.status)) return null;
  const factors: RiskFactor[] = [];
  const add = (code: string, label: string, points: number) => factors.push({ code, label, points });
  const now = input.now.getTime();
  const deadline = input.deadline.getTime();

  if (deadline < now) {
    const days = delayDays(input.deadline, input.now);
    add('OVERDUE', `مهلت ${fa(days)} روز پیش گذشته است`, 100);
  } else {
    const start = Math.min(input.startDate.getTime(), input.createdAt.getTime(), now);
    const span = Math.max(deadline - start, 1);
    const elapsed = Math.min(Math.max((now - start) / span, 0), 1);
    const gap = elapsed * 100 - input.progress;
    if (gap > 50)
      add('BEHIND_SCHEDULE', `پیشرفت ${fa(input.progress)}٪ در حالی که ${fa(elapsed * 100)}٪ زمان سپری شده`, 35);
    else if (gap > 30)
      add('BEHIND_SCHEDULE', `پیشرفت ${fa(input.progress)}٪ در حالی که ${fa(elapsed * 100)}٪ زمان سپری شده`, 25);
    else if (gap > 15) add('BEHIND_SCHEDULE', `پیشرفت کمی عقب‌تر از برنامه است (${fa(input.progress)}٪)`, 12);

    if (input.workingDaysLeft <= 1 && input.progress < 80) {
      add('LITTLE_TIME', input.workingDaysLeft === 0 ? 'مهلت همین امروز است' : 'فقط ۱ روز کاری باقی مانده', 25);
    } else if (input.workingDaysLeft <= 3 && input.progress < 50) {
      add('LITTLE_TIME', `${fa(input.workingDaysLeft)} روز کاری باقی مانده`, 15);
    }
  }

  if (input.priority === 'URGENT') add('PRIORITY', 'اولویت فوری', 10);
  else if (input.priority === 'HIGH') add('PRIORITY', 'اولویت بالا', 5);

  if (input.hasOpenBlocker || input.status === 'BLOCKED') add('BLOCKED', 'مانع باز ثبت شده است', 25);
  else if (input.status === 'WAITING') add('WAITING', 'در انتظار اطلاعات یا رویداد بیرونی', 8);

  if (input.ownerOnLeave) add('OWNER_ON_LEAVE', 'مسئول وظیفه در مرخصی است', 20);

  if (input.groupAvgActiveTasks > 0) {
    const ratio = input.ownerActiveTasks / input.groupAvgActiveTasks;
    if (ratio >= 2) add('WORKLOAD', `مسئول ${fa(input.ownerActiveTasks)} وظیفه فعال دارد (دو برابر میانگین واحد)`, 18);
    else if (ratio >= 1.5)
      add('WORKLOAD', `مسئول ${fa(input.ownerActiveTasks)} وظیفه فعال دارد (بیش از میانگین واحد)`, 12);
  }

  if (input.ownerLateRate !== null && input.ownerHistorySample >= 5 && input.ownerLateRate >= 0.4) {
    add('HISTORICAL_DELAY', `${fa(input.ownerLateRate * 100)}٪ وظایف مشابه اخیر با تأخیر بسته شده‌اند`, 10);
  }

  const idleDays = Math.floor((now - input.lastProgressAt.getTime()) / DAY_MS);
  if (idleDays >= input.staleDays && deadline >= now) {
    add('STALE', `${fa(idleDays)} روز بدون به‌روزرسانی پیشرفت`, 10);
  }

  if (input.status === 'NOT_STARTED' && now - input.startDate.getTime() > 2 * DAY_MS && deadline >= now) {
    add('NOT_STARTED', 'با گذشت زمان شروع، هنوز آغاز نشده', 10);
  }

  const score = Math.min(
    100,
    factors.reduce((s, f) => s + f.points, 0),
  );
  const level: RiskLevel = score >= RISK_THRESHOLDS.high ? 'HIGH' : score >= RISK_THRESHOLDS.medium ? 'MEDIUM' : 'LOW';
  factors.sort((a, b) => b.points - a.points);
  return { level, score, factors, assessedAt: input.now.toISOString() };
}
