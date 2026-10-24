/**
 * Test setup, loaded before every test file (`node --import ./tests/setup.ts`).
 *
 * Running the tests locally
 * -------------------------
 *   1. Create a throwaway database once:
 *        createdb north_end_test
 *   2. Point the suite at it (the name must contain "test" and must not be `north_end`):
 *        export TEST_DATABASE_URL=postgresql://$USER@localhost:5432/north_end_test
 *   3. Run everything (pushes the Prisma schema to the test database first):
 *        npm test
 *      Or a single file, once the schema has been pushed:
 *        node --import tsx --import ./tests/setup.ts --test tests/groups.test.ts
 *
 * Every test truncates all tables first (see resetDatabase in helpers.ts), so test
 * files run one at a time (--test-concurrency=1) against the shared test database.
 *
 * This file must run before any app module is imported: src/lib/prisma.ts reads
 * DATABASE_URL when it's first loaded.
 */
import pg from 'pg';
import { resolveTestDatabaseUrl } from './testDatabase';

process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.APPLE_CLIENT_ID = 'app.vibecheck.ios.test';
process.env.LIFE_SCORE_URL = 'https://vibecheck.test';
process.env.API_URL = 'https://api.vibecheck.test';

// Never talk to APNs from tests
delete process.env.APNS_KEY_ID;
delete process.env.APNS_TEAM_ID;
delete process.env.APNS_PRIVATE_KEY;

// src/lib/prisma.ts creates its own pg Pool, which prisma.$disconnect() doesn't close; idle
// connections would keep each test process alive for pg's 10s idle timeout. Let the process
// exit as soon as the pool is idle instead.
const { Pool } = pg;
pg.Pool = class TestPool extends Pool {
  constructor(config?: pg.PoolConfig) {
    super({ ...config, allowExitOnIdle: true });
  }
} as typeof Pool;
