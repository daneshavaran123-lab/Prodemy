// Test environment defaults; integration tests use a dedicated database.
process.env.NODE_ENV = 'test';
process.env.TZ = 'UTC';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://karban:karban@localhost:5432/karban_test?schema=public';
process.env.QUEUE_DRIVER = 'inline';
process.env.APP_TIMEZONE = 'Asia/Tehran';
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = process.env.STORAGE_LOCAL_DIR ?? '/tmp/karban-test-storage';
process.env.AI_PROVIDER = process.env.AI_PROVIDER ?? 'disabled';
process.env.LOGIN_MAX_ATTEMPTS = '5';
