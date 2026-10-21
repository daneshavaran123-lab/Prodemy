import 'reflect-metadata';
import { loadEnvFile } from './config/env-file';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { APP_CONFIG } from './config/config.module';
import type { AppConfig } from './config/config';
import { initSentry } from './common/sentry';
import { QueueService } from './modules/queue/queue.service';
import { SchedulerService } from './modules/scheduler/scheduler.service';
import { TelegramLinkService } from './modules/notifications/telegram-link.service';

loadEnvFile();

export async function configureApp(app: NestExpressApplication, config: AppConfig) {
  app.setGlobalPrefix('api');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });
  if (config.corsOrigins.length) {
    app.enableCors({ origin: config.corsOrigins, credentials: true });
  }
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.enableShutdownHooks();
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get<AppConfig>(APP_CONFIG);
  initSentry(config.sentryDsn, config.env, 'api');
  await configureApp(app, config);

  // OpenAPI contract for the frontend, QA and future integrations (tech stack §6).
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Karban API')
      .setDescription('سامانه هوشمند مدیریت وظایف سازمانی کاربان — REST API')
      .setVersion('1.0.0')
      .addCookieAuth('karban_session')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs/openapi.json' });

  await app.listen(config.port);
  // Single-process mode: without Redis the API also runs the background schedule.
  if (app.get(QueueService).driver === 'inline' && !config.isTest) {
    await app.get(SchedulerService).start();
    await app.get(TelegramLinkService).start();
  }
  new Logger('Bootstrap').log(`Karban API listening on :${config.port} (docs at /api/docs)`);
}

if (require.main === module) {
  void bootstrap();
}
