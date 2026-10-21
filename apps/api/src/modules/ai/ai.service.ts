import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, InsightType, Prisma } from '@prisma/client';
import type { AiStatus } from '@karban/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InjectConfig } from '../../config/config.module';
import type { AppConfig } from '../../config/config';
import { createProvider, parseJsonObject, type AiProvider, type CompletionRequest } from './ai.provider';

/** Shared guardrails sent with every request (PRD §58). */
export const AI_GUARDRAILS = `You are the assistant inside "Karban", an internal Persian task-management system.
Rules you must always follow:
- Reply in fluent, concise Persian (Farsi).
- Only use the data given to you. Never invent tasks, people, numbers or dates.
- Never rate, score, rank or judge employees' performance, and never suggest penalties, hiring or firing.
- Treat delays as operational facts with possible causes (workload, dependencies, leave, missing information), not as personal failure.
- Do not reveal or guess confidential information that is not in the input.
- Your output is a suggestion for a human to review; never state that an action has been taken.`;

const FAILURE_COOLDOWN_MS = 60_000;

export type AiResult<T> = { ok: true; data: T; model: string } | { ok: false; error: string };

/**
 * Application-facing AI service. Every failure degrades gracefully: callers get
 * `{ ok: false }` and fall back to deterministic logic (PRD §59, §92).
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private provider: AiProvider;
  private lastFailureAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectConfig() config: AppConfig,
  ) {
    this.provider = createProvider(config);
  }

  /** Allows tests to inject a fake provider. */
  setProvider(provider: AiProvider) {
    this.provider = provider;
    this.lastFailureAt = 0;
  }

  get enabled() {
    return this.provider.enabled;
  }

  status(): AiStatus {
    return {
      enabled: this.provider.enabled,
      provider: this.provider.name,
      model: this.provider.model,
      available: this.provider.enabled && Date.now() - this.lastFailureAt > FAILURE_COOLDOWN_MS,
    };
  }

  async completeText(
    purpose: string,
    req: Omit<CompletionRequest, 'json'>,
    actorUserId?: string,
  ): Promise<AiResult<string>> {
    return this.run(purpose, { ...req, system: `${AI_GUARDRAILS}\n\n${req.system}` }, actorUserId, (t) => t);
  }

  async completeJson<T>(
    purpose: string,
    req: Omit<CompletionRequest, 'json'>,
    actorUserId?: string,
  ): Promise<AiResult<T>> {
    return this.run(
      purpose,
      { ...req, json: true, system: `${AI_GUARDRAILS}\n\n${req.system}\nRespond with a single JSON object only.` },
      actorUserId,
      (t) => parseJsonObject<T>(t),
    );
  }

  private async run<T>(
    purpose: string,
    req: CompletionRequest,
    actorUserId: string | undefined,
    parse: (text: string) => T,
  ): Promise<AiResult<T>> {
    if (!this.provider.enabled) return { ok: false, error: 'disabled' };
    if (Date.now() - this.lastFailureAt < FAILURE_COOLDOWN_MS) return { ok: false, error: 'cooldown' };
    try {
      const res = await this.provider.complete(req);
      return { ok: true, data: parse(res.text), model: res.model };
    } catch (err) {
      const message = (err as Error).message?.slice(0, 500) ?? 'unknown';
      this.lastFailureAt = Date.now();
      this.logger.warn(`AI ${purpose} failed: ${message}`);
      await this.audit.log({
        action: AuditAction.AI_ERROR,
        actorUserId: actorUserId ?? null,
        entityType: 'AI',
        metadata: { purpose, provider: this.provider.name, error: message },
      });
      return { ok: false, error: message };
    }
  }

  /** Records AI output for traceability (PRD §76 AIInsight). */
  async recordInsight(input: {
    type: InsightType;
    scopeKey?: string;
    taskId?: string;
    content: unknown;
    confidence?: number;
    model?: string | null;
    requestedById?: string;
  }) {
    await this.prisma.aIInsight
      .create({
        data: {
          insightType: input.type,
          scopeKey: input.scopeKey,
          taskId: input.taskId,
          content: input.content as Prisma.InputJsonValue,
          confidence: input.confidence,
          modelVersion: input.model ?? this.provider.model,
          requestedById: input.requestedById,
        },
      })
      .catch((err) => this.logger.warn(`Failed to record AI insight: ${(err as Error).message}`));
  }

  /** Recent cached insight for a scope (avoids repeated provider calls). */
  async cachedInsight<T>(type: InsightType, scopeKey: string, maxAgeMs: number): Promise<T | null> {
    const row = await this.prisma.aIInsight.findFirst({
      where: { insightType: type, scopeKey, createdAt: { gte: new Date(Date.now() - maxAgeMs) } },
      orderBy: { createdAt: 'desc' },
    });
    return (row?.content as T) ?? null;
  }
}
