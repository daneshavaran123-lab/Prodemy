import { Global, Inject, Module } from '@nestjs/common';
import { loadConfig, type AppConfig } from './config';

export const APP_CONFIG = Symbol('APP_CONFIG');

/** Injects the validated, typed application configuration. */
export const InjectConfig = () => Inject(APP_CONFIG);

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: (): AppConfig => loadConfig() }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
