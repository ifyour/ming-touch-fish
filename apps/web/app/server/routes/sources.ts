import { zValidator } from '@hono/zod-validator';
import { eq, desc } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { createDb, schema } from '@repo/db';
import { extract } from '@extractus/feed-extractor';
import { isLatinText, normalizeUrl } from '@repo/shared';
import type { SourceInput } from '@repo/shared';
import type { Bindings } from '../types';

function normalizeInputUrl(raw: string): string | null {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { return new URL(url).href; } catch { return null; }
}

async function isFeed(url: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return false;
    const text = await res.text();
    return /<(rss|feed|rdf:RDF)\b/i.test(text);
  } catch {
    return false;
  }
}

const FEED_PATHS = ['/feed', '/feed.xml', '/rss', '/rss.xml', '/atom.xml', '/index.xml'];

const createSourceSchema = z.object({
  name: z.string().min(1).max(200),
  url: z.string().url(),
  priority: z.coerce.number().int().default(0),
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
    const res = await fetch(normalized, { signal: AbortSignal.timeout(6000) });
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
    .select()
    .from(schema.sources)
    .orderBy(desc(schema.sources.priority), desc(schema.sources.createdAt));

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
      priority: data.priority ?? 0,
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

async function translateTitle(ai: Bindings['AI'], title: string): Promise<string | null> {
  try {
    const response = await ai.run('@cf/meta/m2m100-1.2b', {
      text: title,
      source_lang: 'en',
      target_lang: 'zh',
    }) as { translated_text?: string };

    return response?.translated_text?.trim() || null;
  } catch {
    return null;
  }
}

app.post('/:id/fetch', async (c) => {
  const id = Number(c.req.param('id'));
  const db = createDb(c.env.DB);

  const source = await db.select().from(schema.sources).where(eq(schema.sources.id, id)).get();
  if (!source) return c.json({ error: 'Source not found' }, 404);

  try {
    const feed = await extract(source.url, {
      descriptionMaxLen: 500,
      getExtraEntryFields: (entry) => ({
        summary: entry['summary'] ?? entry['description'] ?? '',
        author: entry['author'] ?? entry['creator'] ?? '',
        categories: entry['categories'] ?? [],
      }),
    });

    if (!feed?.entries?.length) {
      return c.json({ success: true, articles: 0 });
    }

    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    const pending: Array<{
      title: string;
      url: string;
      publishedAt: Date;
      metadata: Record<string, unknown>;
    }> = [];

    for (const entry of feed.entries) {
      const publishedTime = entry.published ? new Date(entry.published).getTime() : Date.now();
      if (publishedTime < cutoff) continue;
      if (pending.length >= 10) break;

      const url = normalizeUrl(entry.link ?? '');
      if (!url) continue;

      const existing = await db
        .select()
        .from(schema.articles)
        .where(eq(schema.articles.url, url))
        .get();
      if (existing) continue;

      const extra = entry as Record<string, unknown>;
      pending.push({
        title: entry.title ?? 'Untitled',
        url,
        publishedAt: new Date(publishedTime),
        metadata: {
          description: (extra['summary'] as string) ?? '',
          author: (extra['author'] as string) ?? '',
          categories: Array.isArray(extra['categories']) ? extra['categories'] : [],
        },
      });
    }

    const translated = await Promise.all(
      pending.map((a) =>
        isLatinText(a.title) ? translateTitle(c.env.AI, a.title) : Promise.resolve(null)
      )
    );

    for (let i = 0; i < pending.length; i++) {
      await db.insert(schema.articles).values({
        sourceId: source.id,
        title: pending[i].title,
        translatedTitle: translated[i],
        url: pending[i].url,
        publishedAt: pending[i].publishedAt,
        metadata: pending[i].metadata,
      });
    }

    await db
      .update(schema.sources)
      .set({ lastFetchedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.sources.id, id));

    return c.json({ success: true, articles: pending.length });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

export default app;
