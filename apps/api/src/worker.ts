import 'reflect-metadata';
import { loadEnvFile } from './config/env-file';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { APP_CONFIG } from './config/config.module';
import type { AppConfig } from './config/config';
import { initSentry } from './common/sentry';
import { QueueService } from './modules/queue/queue.service';
import { SchedulerService } from './modules/scheduler/scheduler.service';
import { TelegramLinkService } from './modules/notifications/telegram-link.service';

loadEnvFile();

/**
 * Background worker process (tech stack §11, §20 "Worker Container"):
 * executes queued jobs (notifications, e-mail) and the recurring schedule
 * (reminders, overdue detection, recurring tasks, risk, digests, summaries).
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: false });
  app.enableShutdownHooks();
  const config = app.get<AppConfig>(APP_CONFIG);
  initSentry(config.sentryDsn, config.env, 'worker');
  const queue = app.get(QueueService);
  if (queue.driver === 'inline') {
    new Logger('Worker').warn('QUEUE_DRIVER=inline: jobs run inside the API process; the worker is not needed.');
  }
  queue.startWorker(Number(process.env.WORKER_CONCURRENCY ?? 5));
  await app.get(SchedulerService).start();
  await app.get(TelegramLinkService).start();
  new Logger('Worker').log('Karban worker started');
}

void bootstrap();
