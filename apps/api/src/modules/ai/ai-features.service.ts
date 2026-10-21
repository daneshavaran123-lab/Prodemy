import { Injectable } from '@nestjs/common';
import { InsightType } from '@prisma/client';
import {
  PRIORITY_WEIGHT,
  TASK_PRIORITY_LABELS,
  TaskPriority as Priority,
  normalizePersian,
  toPersianDigits,
  workingDaysUntil,
  zonedDateKey,
  zonedTimeToUtc,
  type AiSummary,
  type AiTaskDraft,
  type PrioritySuggestion,
  type TaskPriority,
  type TaskSummary,
  type WorkloadInsight,
  type WorkloadRow,
} from '@karban/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { OrgService } from '../org/org.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { loadDispersion } from '../dashboard/metrics';
import { InjectConfig } from '../../config/config.module';
import type { AppConfig } from '../../config/config';
import type { AuthContext } from '../../common/auth-context';
import { Errors } from '../../common/errors';
import { formatJalali } from '../../common/utils/jalali';
import { toEmployeeRef } from '../../common/serializers';
import { AiService } from './ai.service';
import { heuristicParse } from './heuristic-parser';

const fa = (n: number) => toPersianDigits(n);
const pct = (v: number | null) => (v === null ? '—' : `${fa(Math.round(v * 100))}٪`);
const SUMMARY_CACHE_MS = 30 * 60 * 1000;

/** Strip confidential task content before anything is sent to the external provider (PRD §104). */
function aiSafeTask(t: TaskSummary) {
  return t.confidential
    ? { code: t.code, title: '[محرمانه]', priority: t.priority, deadline: t.deadline, status: t.status }
    : {
        code: t.code,
        title: t.title,
        priority: t.priority,
        deadline: t.deadline,
        status: t.status,
        progress: t.progress,
      };
}

interface AiDraftJson {
  title?: string;
  description?: string;
  assigneeKey?: string | null;
  assigneeName?: string | null;
  deadlineDate?: string | null;
  deadlineTime?: string | null;
  priority?: string;
  tags?: string[];
  confidence?: number;
}

@Injectable()
export class AiFeaturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly settings: SettingsService,
    private readonly org: OrgService,
    private readonly dashboard: DashboardService,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  /* ================================================================ NL task creation (PRD §49) */

  /**
   * Turns free text into a task draft. Nothing is written to the task tables: the user
   * reviews the draft and creates the task through the normal endpoint (PRD §73, §115).
   */
  async parseTask(ctx: AuthContext, text: string, now = new Date()): Promise<AiTaskDraft> {
    const tz = this.config.timeZone;
    const directory = await this.org.directory(ctx, { assignableOnly: true });
    const candidates = directory.slice(0, 200).map((e, i) => ({
      key: `e${i + 1}`,
      id: e.id,
      fullName: e.fullName,
      jobTitle: e.jobTitle,
      department: e.departmentName,
    }));
    const byId = new Map(directory.map((e) => [e.id, e]));
    const todayKey = zonedDateKey(now, tz);
    const toDeadline = (key: string, time?: string | null) => {
      const [h, m] = (time && /^\d{2}:\d{2}$/.test(time) ? time : '23:59').split(':').map(Number);
      return zonedTimeToUtc(key, h, m, tz).toISOString();
    };

    let draft: AiTaskDraft | null = null;
    if (this.ai.enabled) {
      const res = await this.ai.completeJson<AiDraftJson>(
        'task-parse',
        {
          system: `Extract a single task from the user's Persian text.
Return JSON: {"title": string (short, Persian), "description": string, "assigneeKey": string|null (key from candidates, only if clearly named), "assigneeName": string|null (name as written), "deadlineDate": "YYYY-MM-DD" Gregorian|null, "deadlineTime": "HH:MM"|null, "priority": "LOW"|"NORMAL"|"HIGH"|"URGENT", "tags": string[], "confidence": number 0..1}.
Interpret relative dates (فردا، پنجشنبه، هفته بعد، ۱۰ آبان) relative to "today". Iranian weeks start on Saturday; Friday is the weekend.`,
          user: JSON.stringify({
            today: { gregorian: todayKey, jalali: formatJalali(now, tz, { weekday: true }) },
            requester: { key: 'self', name: ctx.fullName },
            candidates: candidates.map(({ key, fullName, jobTitle, department }) => ({
              key,
              name: fullName,
              jobTitle,
              department,
            })),
            text,
          }),
          maxTokens: 500,
        },
        ctx.userId,
      );
      if (res.ok) {
        const d = res.data;
        const warnings: string[] = [];
        const assigneeId =
          d.assigneeKey === 'self' ? ctx.employeeId : candidates.find((c) => c.key === d.assigneeKey)?.id;
        const assignee = (assigneeId && byId.get(assigneeId)) || null;
        if (!assignee) warnings.push('مسئول وظیفه به‌طور قطعی تشخیص داده نشد؛ لطفاً انتخاب کنید.');
        const validDate = d.deadlineDate && /^\d{4}-\d{2}-\d{2}$/.test(d.deadlineDate) && d.deadlineDate >= todayKey;
        if (!validDate) warnings.push('مهلت انجام از متن تشخیص داده نشد؛ لطفاً آن را تعیین کنید.');
        const priority = (Object.values(Priority) as string[]).includes(d.priority ?? '')
          ? (d.priority as TaskPriority)
          : 'NORMAL';
        draft = {
          title: (d.title ?? '').trim().slice(0, 200) || text.slice(0, 80),
          description: (d.description ?? text).trim().slice(0, 5000),
          primaryOwner: assignee ? toEmployeeRef(assignee) : null,
          unresolvedAssignee: assignee ? null : (d.assigneeName ?? null),
          deadline: validDate ? toDeadline(d.deadlineDate!, d.deadlineTime) : null,
          priority,
          tags: Array.isArray(d.tags) ? d.tags.filter((t) => typeof t === 'string').slice(0, 10) : [],
          source: 'ai',
          confidence: typeof d.confidence === 'number' ? Math.max(0, Math.min(1, d.confidence)) : 0.7,
          warnings,
        };
      }
    }

    if (!draft) {
      const h = heuristicParse(text, candidates, ctx.employeeId, now, tz);
      const assignee = h.assigneeId ? (byId.get(h.assigneeId) ?? null) : null;
      draft = {
        title: h.title,
        description: h.description,
        primaryOwner: assignee ? toEmployeeRef(assignee) : null,
        unresolvedAssignee: assignee ? null : h.unresolvedAssignee,
        deadline: h.deadlineKey ? toDeadline(h.deadlineKey) : null,
        priority: h.priority,
        tags: h.tags,
        source: 'heuristic',
        confidence: h.confidence,
        warnings: [
          ...(this.ai.enabled ? ['دستیار هوش مصنوعی موقتاً در دسترس نیست؛ از تحلیل ساده متن استفاده شد.'] : []),
          ...h.warnings,
        ],
      };
    }
    await this.ai.recordInsight({
      type: InsightType.TASK_PARSE,
      scopeKey: `user:${ctx.userId}`,
      content: { text, draft },
      confidence: draft.confidence,
      requestedById: ctx.userId,
    });
    return draft;
  }

  /* ================================================================ priority (PRD §54) */

  async suggestPriority(
    ctx: AuthContext,
    input: { title: string; description?: string; deadline?: Date; primaryOwnerId?: string },
    now = new Date(),
  ): Promise<PrioritySuggestion> {
    const s = await this.settings.get();
    const reasons: string[] = [];
    let score = 0;
    if (input.deadline) {
      const days = workingDaysUntil(now, input.deadline, s.workingDays, s.holidays, this.config.timeZone);
      if (days <= 1) {
        score += 3;
        reasons.push(days === 0 ? 'مهلت امروز است' : 'فقط ۱ روز کاری تا مهلت باقی است');
      } else if (days <= 3) {
        score += 2;
        reasons.push(`${fa(days)} روز کاری تا مهلت باقی است`);
      } else if (days <= 7) {
        score += 1;
        reasons.push('مهلت در هفته پیش رو است');
      }
    }
    const text = normalizePersian(`${input.title} ${input.description ?? ''}`);
    if (/فوری|اضطراری|بحران|قطعی|از کار افتاد/.test(text)) {
      score += 3;
      reasons.push('متن وظیفه به موضوعی اضطراری اشاره دارد');
    } else if (/مشتری|مدیرعامل|هیئت مدیره|حسابرسی|مالیات|قانونی|قرارداد|امنیت/.test(text)) {
      score += 1;
      reasons.push('وظیفه به ذی‌نفع مهم یا الزام قانونی/قراردادی مرتبط است');
    }
    if (input.primaryOwnerId) {
      const open = await this.prisma.task.findMany({
        where: {
          primaryOwnerId: input.primaryOwnerId,
          status: { in: ['NOT_STARTED', 'IN_PROGRESS', 'WAITING', 'BLOCKED'] },
        },
        select: { priority: true },
      });
      const load = open.reduce((sum, t) => sum + PRIORITY_WEIGHT[t.priority], 0);
      if (open.length >= 8 || load >= 20) {
        reasons.push(`مسئول در حال حاضر ${fa(open.length)} وظیفه فعال دارد؛ اولویت‌بندی دقیق اهمیت بیشتری دارد`);
      }
    }
    const heuristic: TaskPriority = score >= 4 ? 'URGENT' : score >= 2 ? 'HIGH' : score >= 1 ? 'NORMAL' : 'LOW';
    if (!reasons.length) reasons.push('نشانه‌ای از فوریت یا نزدیکی مهلت دیده نشد');

    if (this.ai.enabled) {
      const res = await this.ai.completeJson<{ priority?: string; reasons?: string[] }>(
        'priority',
        {
          system:
            'Suggest a priority (LOW|NORMAL|HIGH|URGENT) for the task with 1-3 short Persian reasons. JSON: {"priority": string, "reasons": string[]}. Consider deadline proximity, impact, dependencies and workload. The final decision is the human\'s.',
          user: JSON.stringify({
            title: input.title,
            description: input.description?.slice(0, 1500),
            deadline: input.deadline?.toISOString(),
            today: now.toISOString(),
            signals: reasons,
          }),
          maxTokens: 250,
        },
        ctx.userId,
      );
      if (res.ok && (Object.values(Priority) as string[]).includes(res.data.priority ?? '')) {
        return {
          priority: res.data.priority as TaskPriority,
          reasons: (res.data.reasons ?? []).filter((r) => typeof r === 'string').slice(0, 3),
          source: 'ai',
        };
      }
    }
    return { priority: heuristic, reasons, source: 'heuristic' };
  }

  /* ================================================================ summaries (PRD §50–51, §56) */

  private async withNarrative(
    ctx: AuthContext,
    type: InsightType,
    scopeKey: string,
    base: Omit<AiSummary, 'aiText' | 'aiAvailable' | 'aiError'>,
    context: unknown,
    instruction: string,
  ): Promise<AiSummary> {
    if (!this.ai.enabled) return { ...base, aiText: null, aiAvailable: false, aiError: null };
    const cached = await this.ai.cachedInsight<{ aiText: string; fingerprint: string }>(
      type,
      scopeKey,
      SUMMARY_CACHE_MS,
    );
    const fingerprint = JSON.stringify(base.stats);
    if (cached && cached.fingerprint === fingerprint) {
      return { ...base, aiText: cached.aiText, aiAvailable: true, aiError: null };
    }
    const res = await this.ai.completeText(
      `summary:${type}`,
      { system: instruction, user: JSON.stringify(context), maxTokens: 600, temperature: 0.3 },
      ctx.userId,
    );
    if (!res.ok) {
      return { ...base, aiText: null, aiAvailable: false, aiError: 'دستیار هوش مصنوعی موقتاً در دسترس نیست.' };
    }
    await this.ai.recordInsight({
      type,
      scopeKey,
      content: { aiText: res.data, fingerprint },
      model: res.model,
      requestedById: ctx.userId,
    });
    return { ...base, aiText: res.data, aiAvailable: true, aiError: null };
  }

  async dailySummary(ctx: AuthContext, now = new Date()): Promise<AiSummary> {
    const d = await this.dashboard.employee(ctx, now);
    const startToday = zonedTimeToUtc(zonedDateKey(now, this.config.timeZone), 0, 0, this.config.timeZone);
    const completedToday = d.recentlyCompleted.filter(
      (t) => t.completedAt && new Date(t.completedAt) >= startToday,
    ).length;
    const stats = {
      completedToday,
      active: d.summary.active,
      dueToday: d.summary.dueToday,
      dueSoon: d.summary.dueSoon,
      overdue: d.summary.overdue,
      blocked: d.summary.blocked,
      pendingDelayReasons: d.summary.pendingDelayReasons,
    };
    const parts = [
      completedToday ? `امروز ${fa(completedToday)} وظیفه را تکمیل کرده‌اید.` : 'امروز هنوز وظیفه‌ای تکمیل نشده است.',
      `${fa(stats.active)} وظیفه فعال دارید${stats.dueToday ? ` که ${fa(stats.dueToday)} مورد امروز سررسید است` : ''}.`,
      stats.dueSoon ? `${fa(stats.dueSoon)} وظیفه در سه روز آینده سررسید می‌شود.` : '',
      stats.overdue ? `${fa(stats.overdue)} وظیفه عقب‌افتاده است.` : 'هیچ وظیفه عقب‌افتاده‌ای ندارید.',
      stats.blocked ? `${fa(stats.blocked)} وظیفه مسدود است.` : '',
      stats.pendingDelayReasons ? `برای ${fa(stats.pendingDelayReasons)} وظیفه باید دلیل تأخیر ثبت کنید.` : '',
    ].filter(Boolean);
    const focus = [...d.overdue, ...d.today, ...d.highPriority].slice(0, 3);
    const highlights = focus.map(
      (t) =>
        `${t.code} — ${t.title} (${TASK_PRIORITY_LABELS[t.priority]}، مهلت ${formatJalali(new Date(t.deadline), this.config.timeZone)})`,
    );
    return this.withNarrative(
      ctx,
      InsightType.DAILY_SUMMARY,
      `daily:${ctx.employeeId}:${zonedDateKey(now, this.config.timeZone)}`,
      { scope: 'employee', generatedAt: now.toISOString(), text: parts.join(' '), highlights, stats },
      { stats, focus: focus.map(aiSafeTask), overdue: d.overdue.slice(0, 5).map(aiSafeTask) },
      'Write a short (max 4 sentences) friendly Persian daily briefing for the employee: what was done, what needs attention today, and a suggested order of work. Address the user as «شما».',
    );
  }

  async managerSummary(ctx: AuthContext, departmentId?: string, now = new Date()): Promise<AiSummary> {
    const m = await this.dashboard.manager(ctx, departmentId, now);
    const overloaded = m.workload.filter((w) => w.state === 'OVERLOADED');
    const stats = {
      active: m.kpis.active,
      overdue: m.kpis.overdue,
      atRisk: m.kpis.atRisk,
      blocked: m.kpis.blocked,
      overloaded: overloaded.length,
      pendingReview: m.kpis.pendingReview,
      completed30d: m.kpis.completed,
    };
    // Mirrors the PRD §51 example sentence.
    const text =
      `${m.scope.label} ${fa(stats.active)} وظیفه فعال دارد؛ ${fa(stats.overdue)} وظیفه عقب‌افتاده، ` +
      `${fa(stats.atRisk)} وظیفه در معرض تأخیر` +
      (stats.blocked ? `، ${fa(stats.blocked)} وظیفه مسدود` : '') +
      ` و ${fa(stats.overloaded)} کارمند دارای حجم کاری بالاتر از میانگین واحد هستند.` +
      (m.kpis.onTimeRate !== null ? ` نرخ تکمیل به‌موقع در ۳۰ روز اخیر ${pct(m.kpis.onTimeRate)} بوده است.` : '');
    const highlights = m.needsAttention
      .slice(0, 5)
      .map((i) => `${i.task.code} — ${i.task.title} (${i.task.primaryOwner.fullName})`);
    return this.withNarrative(
      ctx,
      InsightType.MANAGER_SUMMARY,
      `manager:${ctx.employeeId}:${departmentId ?? 'default'}`,
      { scope: m.scope.label, generatedAt: now.toISOString(), text, highlights, stats },
      {
        scope: m.scope.label,
        kpis: m.kpis,
        needsAttention: m.needsAttention
          .slice(0, 8)
          .map((i) => ({ ...aiSafeTask(i.task), owner: i.task.primaryOwner.fullName, reasons: i.reasons })),
        workload: m.workload.slice(0, 10).map((w) => ({
          name: w.employee.fullName,
          active: w.active,
          overdue: w.overdue,
          state: w.state,
          onLeave: w.onLeave,
        })),
      },
      'Write a concise Persian management briefing (max 6 sentences): the overall state, the most important items needing attention and concrete follow-up suggestions. Do not judge individuals; mention workload imbalance neutrally.',
    );
  }

  async executiveSummary(ctx: AuthContext, period: 'week' | 'month', now = new Date()): Promise<AiSummary> {
    if (ctx.scopes.report !== 'all') throw Errors.forbidden('خلاصه مدیریتی سازمان فقط برای مدیریت ارشد در دسترس است.');
    const o = await this.dashboard.organization(ctx, now);
    const ranked = o.departments.filter((d) => d.kpis.active + d.kpis.completed > 0);
    const best = [...ranked]
      .filter((d) => d.kpis.onTimeRate !== null)
      .sort((a, b) => (b.kpis.onTimeRate ?? 0) - (a.kpis.onTimeRate ?? 0))[0];
    const worstOverdue = [...ranked].sort((a, b) => (b.kpis.overdueRate ?? 0) - (a.kpis.overdueRate ?? 0))[0];
    const bottleneck = o.bottlenecks[0];
    const weeks = period === 'week' ? 1 : 4;
    const recent = o.trend.slice(-weeks);
    const previous = o.trend.slice(-2 * weeks, -weeks);
    const sum = (pts: typeof recent, k: 'completed' | 'created') => pts.reduce((s, p) => s + p[k], 0);
    const stats = {
      active: o.kpis.active,
      overdue: o.kpis.overdue,
      atRisk: o.kpis.atRisk,
      blocked: o.kpis.blocked,
      critical: o.critical.length,
      completedRecent: sum(recent, 'completed'),
      completedPrevious: sum(previous, 'completed'),
      overloaded: o.workload.overloaded.length,
    };
    const trendText =
      stats.completedPrevious > 0
        ? stats.completedRecent >= stats.completedPrevious
          ? `تعداد وظایف تکمیل‌شده نسبت به دوره قبل ${fa(stats.completedRecent - stats.completedPrevious)} مورد افزایش داشته است.`
          : `تعداد وظایف تکمیل‌شده نسبت به دوره قبل ${fa(stats.completedPrevious - stats.completedRecent)} مورد کاهش داشته است.`
        : '';
    const parts = [
      `سازمان ${fa(stats.active)} وظیفه فعال دارد؛ ${fa(stats.overdue)} مورد عقب‌افتاده (${pct(o.kpis.overdueRate)}) و ${fa(stats.atRisk)} مورد در معرض تأخیر است.`,
      `نرخ تکمیل به‌موقع سازمان ${pct(o.kpis.onTimeRate)} و میانگین تأخیر ${fa(o.kpis.avgDelayDays)} روز است.`,
      best ? `بهترین نرخ تکمیل به‌موقع متعلق به ${best.department.name} (${pct(best.kpis.onTimeRate)}) است.` : '',
      worstOverdue && (worstOverdue.kpis.overdueRate ?? 0) > 0
        ? `بیشترین سهم وظایف عقب‌افتاده در ${worstOverdue.department.name} (${pct(worstOverdue.kpis.overdueRate)}) دیده می‌شود.`
        : '',
      bottleneck
        ? `بیشترین موانع باز به «${bottleneck.label}» مربوط است (${fa(bottleneck.openBlockers)} مانع روی ${fa(bottleneck.affectedTasks)} وظیفه).`
        : '',
      stats.overloaded ? `${fa(stats.overloaded)} نفر حجم کاری بسیار بالاتر از میانگین دارند.` : '',
      trendText,
    ].filter(Boolean);
    const highlights = o.critical.slice(0, 5).map((t) => `${t.code} — ${t.title} (${t.department.name})`);
    return this.withNarrative(
      ctx,
      InsightType.EXECUTIVE_SUMMARY,
      `executive:${period}`,
      { scope: 'organization', generatedAt: now.toISOString(), text: parts.join(' '), highlights, stats },
      {
        period,
        kpis: o.kpis,
        departments: o.departments.map((d) => ({ name: d.department.name, kpis: d.kpis })),
        bottlenecks: o.bottlenecks.slice(0, 5),
        critical: o.critical.slice(0, 8).map((t) => ({ ...aiSafeTask(t), department: t.department.name })),
        trend: o.trend,
      },
      `Write a Persian executive summary for the CEO covering the last ${period === 'week' ? 'week' : 'month'}: department performance (relative KPIs, not raw counts), major delays, bottlenecks, risks, workload and trends. Use short paragraphs or bullet points, max 180 words.`,
    );
  }

  /* ================================================================ workload (PRD §55) */

  async workloadInsight(ctx: AuthContext, departmentId?: string): Promise<WorkloadInsight> {
    const m = await this.dashboard.manager(ctx, departmentId);
    return this.describeWorkload(m.workload);
  }

  describeWorkload(rows: WorkloadRow[]): WorkloadInsight {
    const overloaded = rows.filter((r) => r.state === 'OVERLOADED');
    const underutilized = rows.filter((r) => r.state === 'UNDERUTILIZED');
    const dispersion = loadDispersion(rows);
    const notes: string[] = [];
    if (overloaded.length) notes.push(`${fa(overloaded.length)} نفر بار کاری بیش از ${fa(1.5)} برابر میانگین دارند.`);
    if (underutilized.length) notes.push(`${fa(underutilized.length)} نفر ظرفیت آزاد قابل توجهی دارند.`);
    if (dispersion > 0.6) notes.push('توزیع کار در این گروه ناهمگون است؛ بازتوزیع دستی وظایف را بررسی کنید.');
    if (rows.some((r) => r.onLeave && r.active > 0))
      notes.push('برخی وظایف فعال متعلق به افرادی است که در مرخصی هستند.');
    notes.push('این تحلیل صرفاً پیشنهادی است و هیچ وظیفه‌ای به‌صورت خودکار جابه‌جا نمی‌شود.');
    return { overloaded, underutilized, unevenDistribution: dispersion > 0.6, dispersion, notes };
  }
}
