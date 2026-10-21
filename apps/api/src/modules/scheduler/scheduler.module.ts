import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module';
import { RecurrenceModule } from '../recurrence/recurrence.module';
import { PerformanceModule } from '../performance/performance.module';
import { DeadlineScanner } from './deadline.scanner';
import { RecurrenceRunner } from './recurrence.runner';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [TasksModule, RecurrenceModule, PerformanceModule],
  providers: [DeadlineScanner, RecurrenceRunner, SchedulerService],
  exports: [SchedulerService, DeadlineScanner, RecurrenceRunner],
})
export class SchedulerModule {}
