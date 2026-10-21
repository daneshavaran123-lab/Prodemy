import { Module } from '@nestjs/common';
import { RecurrenceModule } from '../recurrence/recurrence.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TaskActivityService } from './task-activity.service';
import { TaskAccessService } from './task-access.service';
import { TaskNotifier } from './task-notifier';

@Module({
  imports: [RecurrenceModule],
  controllers: [TasksController],
  providers: [TasksService, TaskActivityService, TaskAccessService, TaskNotifier],
  exports: [TasksService, TaskAccessService, TaskNotifier],
})
export class TasksModule {}
