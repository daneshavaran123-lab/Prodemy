import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { InjectConfig } from '../../config/config.module';
import type { AppConfig } from '../../config/config';
import { captureException } from '../../common/sentry';

export const QUEUE_NAME = 'karban';

export type JobHandler = (data: any) => Promise<void>;

/**
 * Thin job abstraction over BullMQ (tech stack §11).
 *
 * - `redis` driver: the API process only enqueues; the worker process (`dist/worker.js`)
 *   calls `startWorker()` and executes registered handlers.
 * - `inline` driver: handlers run in-process right after the current tick
 *   (tests and single-process development without Redis).
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly handlers = new Map<string, JobHandler>();
  private connection: IORedis | null = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private readonly inflight = new Set<Promise<void>>();

  constructor(@InjectConfig() private readonly config: AppConfig) {}

  get driver() {
    return this.config.queueDriver;
  }

  register(name: string, handler: JobHandler) {
    this.handlers.set(name, handler);
  }

  private getConnection(): IORedis {
    this.connection ??= new IORedis(this.config.redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: false,
    });
    return this.connection;
  }

  private getQueue(): Queue {
    this.queue ??= new Queue(QUEUE_NAME, {
      connection: this.getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 7 * 24 * 3600, count: 5000 },
        removeOnFail: { age: 30 * 24 * 3600 },
      },
    });
    return this.queue;
  }

  async enqueue(name: string, data: unknown, opts?: JobsOptions): Promise<void> {
    if (this.driver === 'inline') {
      const handler = this.handlers.get(name);
      if (!handler) return;
      const run = new Promise<void>((resolve) => setImmediate(resolve))
        .then(() => handler(data))
        .catch((err) => {
          this.logger.error(`Inline job ${name} failed: ${(err as Error).message}`);
          captureException(err);
        })
        .finally(() => this.inflight.delete(run));
      this.inflight.add(run);
      return;
    }
    await this.getQueue().add(name, data, opts);
  }

  /** Registers (or updates) a repeatable job; no-op for the inline driver. */
  async schedule(name: string, everyMs: number, data: unknown = {}): Promise<void> {
    if (this.driver === 'inline') return;
    await this.getQueue().upsertJobScheduler(`repeat:${name}`, { every: everyMs }, { name, data });
  }

  /** Waits for in-process jobs to settle (inline driver; used by tests). */
  async drain(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
  }

  async isHealthy(): Promise<boolean> {
    if (this.driver === 'inline') return true;
    try {
      return (await this.getConnection().ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  startWorker(concurrency = 5): void {
    if (this.driver === 'inline' || this.worker) return;
    this.worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        const handler = this.handlers.get(job.name);
        if (!handler) {
          this.logger.warn(`No handler registered for job "${job.name}"`);
          return;
        }
        await handler(job.data);
      },
      { connection: this.getConnection(), concurrency },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.name}#${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`);
      captureException(err);
    });
    this.logger.log(`Worker started (concurrency ${concurrency}, handlers: ${[...this.handlers.keys()].join(', ')})`);
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    if (this.connection) this.connection.disconnect();
  }
}
