import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Loads `.env` for local development without overriding variables that are already
 * set (container platforms inject real environment variables). Skipped under tests.
 */
export function loadEnvFile(file = path.resolve(process.cwd(), '.env')): void {
  if (process.env.NODE_ENV === 'test' || !existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
