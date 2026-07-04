import { zValidator } from '@hono/zod-validator';
import { eq, desc, asc, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { createDb, schema } from '@repo/db';
import { extract } from '@extractus/feed-extractor';
import { logger } from '@repo/telemetry';
import type { SourceInput } from '@repo/shared';
import type { Bindings } from '../types';

function normalizeInputUrl(raw: string): string | null {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { return new URL(url).href; } catch { return null; }
}

async function isFeed(url: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(url, { signal, headers: { 'user-agent': UA } });
    if (!res.ok) return false;
    const text = await res.text();
    return /<(rss|feed|rdf:RDF)\b/i.test(text);
  } catch {
    return false;
  }
}

const FEED_PATHS = ['/feed', '/feed.xml', '/rss', '/rss.xml', '/atom.xml', '/index.xml'];

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const createSourceSchema = z.object({
  name: z.string().min(1).max(200),
  url: z.string().url(),
  fetchFrequency: z.enum(['hourly', 'twice_daily', 'daily']).default('daily'),
  isActive: z.coerce.boolean().default(true),
});

const updateSourceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  url: z.string().url().optional(),
  priority: z.coerce.number().int().optional(),
  fetchFrequency: z.enum(['hourly', 'twice_daily', 'daily']).optional(),
  isActive: z.coerce.boolean().optional(),
});

const app = new Hono<{ Bindings: Bindings }>();

app.post('/detect', zValidator('json', z.object({ url: z.string() })), async (c) => {
  const { url } = c.req.valid('json');
  const normalized = normalizeInputUrl(url);
  if (!normalized) return c.json({ feedUrl: null });

  let parsed: URL;
  try { parsed = new URL(normalized); } catch { return c.json({ feedUrl: null }); }

  const candidates = new Set<string>();
  candidates.add(normalized);

  const origin = parsed.origin;
  for (const p of FEED_PATHS) candidates.add(new URL(p, origin).href);

  const base = parsed.pathname.replace(/\/$/, '');
  if (base && base !== '/') {
    for (const p of FEED_PATHS) candidates.add(new URL(base + p, origin).href);
  }

  try {
    const res = await fetch(normalized, { signal: AbortSignal.timeout(6000), headers: { 'user-agent': UA } });
    const html = await res.text();
    const re = /<link[^>]*?rel=["']alternate["'][^>]*?type=["']application\/(?:rss|atom)\+xml["'][^>]*?href=["']([^"']+)["']/gi;
    const re2 = /<link[^>]*?type=["']application\/(?:rss|atom)\+xml["'][^>]*?rel=["']alternate["'][^>]*?href=["']([^"']+)["']/gi;
    for (const r of [re, re2]) {
      for (const m of html.matchAll(r)) {
        try { candidates.add(new URL(m[1], normalized).href); } catch {}
      }
    }
  } catch {}

  for (const candidate of candidates) {
    try {
      if (await isFeed(candidate, AbortSignal.timeout(5000))) {
        const feed = await extract(candidate).catch(() => null);
        return c.json({ feedUrl: candidate, sourceName: feed?.title || null });
      }
    } catch {}
  }

  return c.json({ feedUrl: null, sourceName: null });
});

app.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const sources = await db
    .select({
      id: schema.sources.id,
      name: schema.sources.name,
      url: schema.sources.url,
      priority: schema.sources.priority,
      fetchFrequency: schema.sources.fetchFrequency,
      isActive: schema.sources.isActive,
      lastFetchedAt: schema.sources.lastFetchedAt,
      createdAt: schema.sources.createdAt,
      updatedAt: schema.sources.updatedAt,
      lastFetchCount: sql<number>`(
        SELECT COUNT(*) FROM articles
        WHERE articles.source_id = sources.id
          AND articles.fetched_at >= sources.last_fetched_at - 300
          AND articles.fetched_at <= sources.last_fetched_at + 1
      )`.as('last_fetch_count'),
    })
    .from(schema.sources)
    .orderBy(
      desc(schema.sources.isActive),
      desc(schema.sources.priority),
      asc(schema.sources.createdAt)
    );

  c.header('Cache-Control', 'no-cache, no-store');
  return c.json(sources);
});

app.post('/', zValidator('json', createSourceSchema), async (c) => {
  const db = createDb(c.env.DB);
  const data = c.req.valid('json') as SourceInput;

  const result = await db
    .insert(schema.sources)
    .values({
      name: data.name,
      url: data.url,
      fetchFrequency: data.fetchFrequency ?? 'daily',
      isActive: data.isActive ?? true,
    })
    .returning();

  return c.json(result[0], 201);
});

app.get('/:id', async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param('id'));

  const source = await db.select().from(schema.sources).where(eq(schema.sources.id, id)).get();
  if (!source) return c.json({ error: 'Source not found' }, 404);

  return c.json(source);
});

app.patch('/:id', zValidator('json', updateSourceSchema), async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const result = await db
    .update(schema.sources)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(schema.sources.id, id))
    .returning();

  if (result.length === 0) return c.json({ error: 'Source not found' }, 404);
  return c.json(result[0]);
});

app.delete('/:id', async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param('id'));

  const result = await db.delete(schema.sources).where(eq(schema.sources.id, id)).returning();
  if (result.length === 0) return c.json({ error: 'Source not found' }, 404);

  return c.json({ success: true });
});

app.post('/fetch-all', async (c) => {
  const db = createDb(c.env.DB);
  const sources = await db.select().from(schema.sources).where(eq(schema.sources.isActive, true));

  let queued = 0;
  for (const source of sources) {
    try {
      await c.env.NEWS_QUEUE.send({ sourceId: source.id });
      queued++;
    } catch (err) {
      logger.error(`Failed to queue source ${source.id}`, { service: 'web-api', sourceId: source.id, error: err });
    }
  }

  return c.json({ success: true, queued });
});

app.post('/:id/fetch', async (c) => {
  const id = Number(c.req.param('id'));
  const db = createDb(c.env.DB);

  const source = await db.select().from(schema.sources).where(eq(schema.sources.id, id)).get();
  if (!source) return c.json({ error: 'Source not found' }, 404);

  try {
    await c.env.NEWS_QUEUE.send({ sourceId: id });
    return c.json({ success: true, queued: true });
  } catch (err) {
    logger.error(`Failed to queue source ${id}`, { service: 'web-api', sourceId: id, error: err });
    return c.json({ error: 'Failed to queue fetch' }, 500);
  }
});

export default app;
