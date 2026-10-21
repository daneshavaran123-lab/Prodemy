import { Logger } from '@nestjs/common';
import type { AppConfig } from '../../config/config';

export interface CompletionRequest {
  system: string;
  user: string;
  /** Ask the provider for a JSON object response. */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export interface CompletionResult {
  text: string;
  model: string;
}

/**
 * AI Provider Abstraction (tech stack §13). Business logic depends on this interface
 * only, so the provider/model can change (or a local LLM be added) without touching
 * the task core.
 */
export interface AiProvider {
  readonly name: string;
  readonly model: string | null;
  readonly enabled: boolean;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export class DisabledProvider implements AiProvider {
  readonly name = 'disabled';
  readonly model = null;
  readonly enabled = false;

  complete(): Promise<CompletionResult> {
    return Promise.reject(new Error('AI provider is disabled'));
  }
}

/** Any OpenAI-compatible Chat Completions endpoint (OpenAI, Azure gateways, vLLM, Ollama, …). */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly name = 'openai-compatible';
  readonly enabled = true;
  private readonly logger = new Logger(OpenAiCompatibleProvider.name);

  constructor(private readonly cfg: AppConfig['ai']) {}

  get model() {
    return this.cfg.model;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.cfg.model,
        temperature: req.temperature ?? 0.2,
        max_tokens: req.maxTokens ?? 800,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        ...(req.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`AI provider HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('AI provider returned an empty response');
    this.logger.debug(`AI completion ok (${json.model ?? this.cfg.model})`);
    return { text, model: json.model ?? this.cfg.model };
  }
}

export function createProvider(config: AppConfig): AiProvider {
  if (config.ai.provider === 'openai') return new OpenAiCompatibleProvider(config.ai);
  return new DisabledProvider();
}

/** Extracts the first JSON object from a model reply (tolerates code fences). */
export function parseJsonObject<T>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in AI response');
  return JSON.parse(raw.slice(start, end + 1)) as T;
}
