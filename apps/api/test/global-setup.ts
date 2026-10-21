import { execSync } from 'node:child_process';
import path from 'node:path';

/** Applies migrations to the dedicated test database once per Jest run. */
export default function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://karban:karban@localhost:5432/karban_test?schema=public';
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
