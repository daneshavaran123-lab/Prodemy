import { Module } from '@nestjs/common';
import { AuditModule } from './modules/audit/audit.module';
import { SettingsModule } from './modules/settings/settings.module';
import { QueueModule } from './modules/queue/queue.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { StorageModule } from './modules/storage/storage.service';
import { RiskModule } from './modules/risk/risk.service';

/** Global infrastructure shared by the API and the worker processes. */
@Module({
  imports: [AuditModule, SettingsModule, QueueModule, NotificationsModule, StorageModule, RiskModule],
  exports: [AuditModule, SettingsModule, QueueModule, NotificationsModule, StorageModule, RiskModule],
})
export class CoreModule {}
