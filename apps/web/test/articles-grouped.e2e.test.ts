import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

const DAY = 86400;

async function clearAll() {
  await env.DB.prepare('DELETE FROM articles').run();
  await env.DB.prepare('DELETE FROM sources').run();
}

async function seedSource(opts: {
  name: string;
  url: string;
  priority: number;
  isActive?: boolean;
  articleAgeDays?: number;
}): Promise<number> {
  const { name, url, priority, isActive = true, articleAgeDays } = opts;
  const now = Math.floor(Date.now() / 1000);
  const insert = await env.DB.prepare(
    `INSERT INTO sources (name, url, priority, fetch_frequency, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 'daily', ?, ?, ?)`,
  )
    .bind(name, url, priority, isActive ? 1 : 0, now, now)
    .run();
  const sourceId = Number(insert.meta.last_row_id);
  if (articleAgeDays !== undefined) {
    await env.DB.prepare(
      `INSERT INTO articles (source_id, title, url, published_at, fetched_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(sourceId, `Article in ${name}`, `${url}/a${sourceId}`, now - articleAgeDays * DAY, now)
      .run();
  }
  return sourceId;
}

describe('GET /api/articles/grouped', () => {
  beforeEach(async () => {
    await clearAll();
  });

  it('returns only active sources by default and flags stale availability', async () => {
    await seedSource({
      name: 'Active',
      url: 'https://active.test',
      priority: 10,
      articleAgeDays: 1,
    });
    await seedSource({ name: 'Stale', url: 'https://stale.test', priority: 5, articleAgeDays: 40 });
    await seedSource({
      name: 'Inactive',
      url: 'https://inactive.test',
      priority: 1,
      isActive: false,
      articleAgeDays: 1,
    });

    const res = await SELF.fetch('https://localhost/api/articles/grouped');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Has-Stale')).toBe('true');
    const body = (await res.json()) as Array<{ source: { name: string } }>;
    expect(body.map((g) => g.source.name).sort()).toEqual(['Active']);
  });

  it('returns only stale sources for scope=stale', async () => {
    await seedSource({
      name: 'Active',
      url: 'https://active2.test',
      priority: 10,
      articleAgeDays: 1,
    });
    await seedSource({
      name: 'Stale',
      url: 'https://stale2.test',
      priority: 5,
      articleAgeDays: 40,
    });

    const res = await SELF.fetch('https://localhost/api/articles/grouped?scope=stale');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ source: { name: string } }>;
    expect(body.map((g) => g.source.name)).toEqual(['Stale']);
  });

  it('omits X-Has-Stale when no stale sources exist', async () => {
    await seedSource({
      name: 'Active',
      url: 'https://active3.test',
      priority: 10,
      articleAgeDays: 1,
    });
    const res = await SELF.fetch('https://localhost/api/articles/grouped');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Has-Stale')).toBe('false');
  });

  it('never includes inactive sources', async () => {
    await seedSource({
      name: 'Active',
      url: 'https://active4.test',
      priority: 10,
      articleAgeDays: 1,
    });
    await seedSource({
      name: 'Inactive',
      url: 'https://inactive4.test',
      priority: 1,
      isActive: false,
      articleAgeDays: 1,
    });

    const res = await SELF.fetch('https://localhost/api/articles/grouped');
    const body = (await res.json()) as Array<{ source: { name: string } }>;
    expect(body.map((g) => g.source.name)).toEqual(['Active']);
  });
});
