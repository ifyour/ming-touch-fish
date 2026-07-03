import { zValidator } from '@hono/zod-validator';
import { eq, desc } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { createDb, schema } from '@repo/db';
import { extract, extractFromXml, type FeedData } from '@extractus/feed-extractor';
import { isLatinText, normalizeUrl, isCloudflareQuotaError } from '@repo/shared';
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

const V2EX_API = 'https://www.v2ex.com/api/topics/latest.json';

async function fetchFeed(url: string): Promise<FeedData> {
  if (url.includes('v2ex.com/index.xml')) {
    const topics = await fetch(V2EX_API, {
      signal: AbortSignal.timeout(10000),
      headers: { 'user-agent': UA },
    }).then(r => { if (!r.ok) throw new Error(`V2EX API: ${r.status}`); return r.json(); }) as Array<Record<string, unknown>>;
    return {
      title: 'V2EX',
      link: 'https://v2ex.com/',
      description: 'V2EX 最新主题',
      entries: topics.slice(0, 20).map((t: Record<string, unknown>) => ({
        id: `v2ex-${t['id']}`,
        title: String(t['title'] ?? ''),
        link: `https://v2ex.com/t/${t['id']}`,
        published: t['created'] ? new Date(Number(t['created']) * 1000).toISOString() : undefined,
        description: t['content_rendered'] as string | undefined,
        author: (t['member'] as Record<string, unknown>)?.['username'] as string | undefined,
      })),
    };
  }

  const uas = [UA, 'Mozilla/5.0 (compatible; Feedfetcher-Google; +http://www.google.com/feedfetcher.html)'];
  for (const ua of uas) {
    try {
      return await extract(url, {
        descriptionMaxLen: 500,
        getExtraEntryFields: (entry) => ({
          summary: entry['summary'] ?? entry['description'] ?? '',
          author: entry['author'] ?? entry['creator'] ?? '',
          categories: entry['categories'] ?? [],
        }),
      }, { headers: { 'user-agent': ua }, signal: AbortSignal.timeout(10000) });
    } catch (err) {
      logger.warn(`Extract failed for ${url} with UA [${ua.slice(0, 40)}...]`, { service: 'web-api', error: err });
    }
  }
  for (const ua of uas) {
    const resp = await fetch(url, { headers: { 'user-agent': ua }, signal: AbortSignal.timeout(10000) });
    if (resp.ok) {
      const xml = await resp.text();
      return extractFromXml(xml, {
        descriptionMaxLen: 500,
        getExtraEntryFields: (entry) => ({
          summary: entry['summary'] ?? entry['description'] ?? '',
          author: entry['author'] ?? entry['creator'] ?? '',
          categories: entry['categories'] ?? [],
        }),
      });
    }
    logger.warn(`Fetch failed for ${url} with UA [${ua.slice(0, 40)}...]: HTTP ${resp.status}`, { service: 'web-api' });
  }
  throw new Error(`All fetch attempts failed for ${url}`);
}

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
    const response = await ai.run('@cf/zai-org/glm-4.7-flash', {
      messages: [
        {
          role: 'system',
          content:
            'Translate the English tech article title into natural Chinese. Rules: (1) Keep Cloudflare product names untranslated: Workers, Durable Objects, R2, KV, D1, Turnstile, Queues, Cron Triggers, Email Workers, Analytics Engine, Secrets, Environments, AI Gateway, Vectorize. (2) Keep other English brand/product names when that sounds more natural. (3) Output ONLY the translation, no explanation.',
        },
        { role: 'user', content: title },
      ],
    }, { signal: AbortSignal.timeout(15000) }) as { response?: string };

    return response?.response?.trim() || null;
  } catch {
    return null;
  }
}

async function translateTitlesSequential(ai: Bindings['AI'], titles: string[]): Promise<(string | null)[]> {
  const results: (string | null)[] = [];
  for (const title of titles) {
    results.push(await translateTitle(ai, title));
  }
  return results;
}

app.post('/fetch-all', async (c) => {
  const db = createDb(c.env.DB);
  const sources = await db.select().from(schema.sources).where(eq(schema.sources.isActive, true));

  let total = 0;
  const sourceResults: Array<{ name: string; stored: number; warning?: string }> = [];
  for (const source of sources) {
    try {
      const feed = await fetchFeed(source.url);
      if (!feed?.entries?.length) continue;

      const sorted = feed.entries
        .map((entry) => {
          const publishedTime = entry.published ? new Date(entry.published).getTime() : Date.now();
          return { ...entry, publishedTime };
        })
        .sort((a, b) => b.publishedTime - a.publishedTime);

      const pending: Array<{
        title: string; url: string; publishedAt: Date; metadata: Record<string, unknown>;
      }> = [];

      let quotaError: string | null = null;

      for (const entry of sorted) {
        try {
          const publishedTime = entry.published ? new Date(entry.published).getTime() : Date.now();
          const url = normalizeUrl(entry.link ?? '');
          if (!url) continue;
          const existing = await db.select().from(schema.articles).where(eq(schema.articles.url, url)).get();
          if (existing) continue;
          const extra = entry as unknown as Record<string, unknown>;
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
        } catch (err) {
          const quotaMsg = isCloudflareQuotaError(err);
          if (quotaMsg) { quotaError = quotaMsg; break; }
          throw err;
        }
      }

      let inserted = 0;
      for (const a of pending) {
        try {
          await db.insert(schema.articles).values({
            sourceId: source.id,
            title: a.title,
            translatedTitle: null,
            url: a.url,
            publishedAt: a.publishedAt,
            metadata: a.metadata,
          });
          inserted++;
        } catch (err) {
          const quotaMsg = isCloudflareQuotaError(err);
          if (quotaMsg) {
            if (!quotaError) quotaError = quotaMsg;
            break;
          }
          throw err;
        }
      }

      await db
        .update(schema.sources)
        .set({ lastFetchedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.sources.id, source.id));

      total += inserted;
      const result: { name: string; stored: number; warning?: string } = { name: source.name, stored: inserted };
      if (quotaError) {
        result.warning = quotaError;
        logger.error(`Fetch-all partial for ${source.name}: ${quotaError}`, { service: 'web-api', sourceName: source.name, error: quotaError });
      }
      sourceResults.push(result);
    } catch (err) {
      logger.error(`Fetch-all failed for ${source.name}`, { service: 'web-api', sourceName: source.name, error: err });
      sourceResults.push({ name: source.name, stored: 0, warning: String(err) });
    }
  }
  return c.json({ success: true, totalFetched: total, sources: sourceResults });
});

app.post('/:id/fetch', async (c) => {
  const id = Number(c.req.param('id'));
  const db = createDb(c.env.DB);

  const source = await db.select().from(schema.sources).where(eq(schema.sources.id, id)).get();
  if (!source) return c.json({ error: 'Source not found' }, 404);

  try {
    const feed = await fetchFeed(source.url);

    if (!feed?.entries?.length) {
      return c.json({ success: true, articles: 0 });
    }

    const sorted = feed.entries
      .map((entry) => {
        const publishedTime = entry.published ? new Date(entry.published).getTime() : Date.now();
        return { ...entry, publishedTime };
      })
      .sort((a, b) => b.publishedTime - a.publishedTime);

    const pending: Array<{
      title: string;
      url: string;
      publishedAt: Date;
      metadata: Record<string, unknown>;
    }> = [];

    let quotaError: string | null = null;

    for (const entry of sorted) {
      try {
        const url = normalizeUrl(entry.link ?? '');
        if (!url) continue;

        const existing = await db
          .select()
          .from(schema.articles)
          .where(eq(schema.articles.url, url))
          .get();
        if (existing) continue;

        const extra = entry as unknown as Record<string, unknown>;
        pending.push({
          title: entry.title ?? 'Untitled',
          url,
          publishedAt: new Date(entry.publishedTime),
          metadata: {
            description: (extra['summary'] as string) ?? '',
            author: (extra['author'] as string) ?? '',
            categories: Array.isArray(extra['categories']) ? extra['categories'] : [],
          },
        });
      } catch (err) {
        const quotaMsg = isCloudflareQuotaError(err);
        if (quotaMsg) { quotaError = quotaMsg; break; }
        throw err;
      }
    }

    let inserted = 0;
    for (const a of pending) {
      try {
        await db.insert(schema.articles).values({
          sourceId: source.id,
          title: a.title,
          translatedTitle: null,
          url: a.url,
          publishedAt: a.publishedAt,
          metadata: a.metadata,
        });
        inserted++;
      } catch (err) {
        const quotaMsg = isCloudflareQuotaError(err);
        if (quotaMsg) {
          if (!quotaError) quotaError = quotaMsg;
          break;
        }
        throw err;
      }
    }

    await db
      .update(schema.sources)
      .set({ lastFetchedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.sources.id, id));

    const resp: Record<string, unknown> = { success: true, articles: inserted };
    if (quotaError) {
      resp.warning = quotaError;
      resp.totalFound = pending.length;
    }
    return c.json(resp);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
export default app;
