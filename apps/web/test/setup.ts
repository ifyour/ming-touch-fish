import { env } from 'cloudflare:test';
import { beforeAll } from 'vitest';

declare const __MIGRATION_SQL__: string;

async function applyMigrations() {
  const existing = (await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='sources'",
  ).first()) as { name?: string } | null;
  if (existing?.name === 'sources') return;

  for (const statement of __MIGRATION_SQL__.split(';')) {
    const sql = statement.trim();
    if (sql) await env.DB.prepare(sql).run();
  }
}

beforeAll(applyMigrations);
