import { zValidator } from '@hono/zod-validator';
import { eq, desc } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { createDb, schema } from '@repo/db';
import { extract } from '@extractus/feed-extractor';
import { normalizeUrl } from '@repo/shared';
import type { SourceInput } from '@repo/shared';
import type { Bindings } from '../types';

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
    let stored = 0;

    for (const entry of feed.entries) {
      const publishedTime = entry.published ? new Date(entry.published).getTime() : Date.now();
      if (publishedTime < cutoff) continue;
      if (stored >= 10) break;

      const url = normalizeUrl(entry.link ?? '');
      if (!url) continue;

      const existing = await db
        .select()
        .from(schema.articles)
        .where(eq(schema.articles.url, url))
        .get();
      if (existing) continue;

      const title = entry.title ?? 'Untitled';
      const extra = entry as Record<string, unknown>;
      await db.insert(schema.articles).values({
        sourceId: source.id,
        title,
        url,
        publishedAt: new Date(publishedTime),
        metadata: {
          description: (extra['summary'] as string) ?? '',
          author: (extra['author'] as string) ?? '',
          categories: Array.isArray(extra['categories']) ? extra['categories'] : [],
        },
      });
      stored++;
    }

    await db
      .update(schema.sources)
      .set({ lastFetchedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.sources.id, id));

    return c.json({ success: true, articles: stored });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

export default app;
