// Resolves and sanity-checks the database the test suite is allowed to use.
// Shared by setup.ts (runs before each test file) and pushSchema.ts.

export function resolveTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Point it at a throwaway database, e.g. ' +
        'postgresql://localhost:5432/north_end_test (see tests/setup.ts).'
    );
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid URL');
  }

  // Tests truncate every table, so never run them against a real database.
  if (databaseName === 'north_end' || !databaseName.includes('test')) {
    throw new Error(
      `Refusing to run tests against database "${databaseName}": ` +
        'TEST_DATABASE_URL must name a separate database whose name contains "test".'
    );
  }

  return url;
}
