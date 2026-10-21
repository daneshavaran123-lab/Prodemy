/**
 * Unit tests live next to sources (*.spec.ts); integration tests in test/ (*.e2e-spec.ts)
 * run against a real PostgreSQL test database (TEST_DATABASE_URL), serially.
 */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  transform: { '^.+\\.(t|j)s$': ['@swc/jest'] },
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  globalSetup: '<rootDir>/test/global-setup.ts',
  testTimeout: 30000,
  // Integration suites share one database.
  maxWorkers: 1,
};
