import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const migrationsDir = join(process.cwd(), 'packages/db/migrations');
const migrationSql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(migrationsDir, f), 'utf8'))
  .join('\n');

export default defineConfig({
  define: {
    __MIGRATION_SQL__: JSON.stringify(migrationSql),
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: 'apps/web/wrangler.e2e.toml' },
    }),
  ],
  test: {
    pool: 'cloudflare-pool',
    include: ['apps/web/test/**/*.test.ts'],
    setupFiles: ['apps/web/test/setup.ts'],
    testTimeout: 30000,
  },
});
