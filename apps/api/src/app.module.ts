import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { KarbanThrottlerGuard, skipThrottleInTests, THROTTLERS } from './common/guards/throttler.guard';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.service';
import { AuthGuard } from './common/guards/auth.guard';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { CoreModule } from './core.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { OrgModule } from './modules/org/org.module';
import { RolesModule } from './modules/roles/roles.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { RecurrenceModule } from './modules/recurrence/recurrence.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ReportsModule } from './modules/reports/reports.module';
import { PerformanceModule } from './modules/performance/performance.module';
import { AiModule } from './modules/ai/ai.module';
import { SavedViewsModule } from './modules/saved-views/saved-views.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { HealthModule } from './modules/health/health.controller';
import { SchedulerModule } from './modules/scheduler/scheduler.module';

/**
 * HTTP API composition root (modular monolith, tech stack §5).
 * Each feature is a Nest module with its own controller/service boundary.
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ThrottlerModule.forRoot({ throttlers: THROTTLERS, skipIf: skipThrottleInTests }),
    CoreModule,
    AuthModule,
    UsersModule,
    OrgModule,
    RolesModule,
    ProjectsModule,
    TasksModule,
    RecurrenceModule,
    DashboardModule,
    ReportsModule,
    PerformanceModule,
    AiModule,
    SavedViewsModule,
    IntegrationsModule,
    HealthModule,
    SchedulerModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: KarbanThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
