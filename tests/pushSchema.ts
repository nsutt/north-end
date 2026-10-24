// Pushes prisma/schema.prisma to the test database (`npm run test:db-push`, also run by `npm test`).
// prisma.config.ts reads DATABASE_URL, so it's pointed at TEST_DATABASE_URL for this command only.
import { spawnSync } from 'child_process';
import { resolveTestDatabaseUrl } from './testDatabase';

const url = resolveTestDatabaseUrl();
const result = spawnSync('npx', ['prisma', 'db', 'push', '--accept-data-loss'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: url },
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
