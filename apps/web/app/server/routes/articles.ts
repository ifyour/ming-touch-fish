import { eq, desc } from 'drizzle-orm';
import { Hono } from 'hono';
import { createDb, schema } from '@repo/db';
import type { Bindings } from '../types';

const app = new Hono<{ Bindings: Bindings }>();

app.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const query = c.req.query();

  const sourceId = query.sourceId ? Number(query.sourceId) : undefined;
  const limit = Math.min(Number(query.limit ?? '50'), 100);
  const offset = Number(query.offset ?? '0');

  const where = sourceId ? eq(schema.articles.sourceId, sourceId) : undefined;

  const articles = await db
    .select()
    .from(schema.articles)
    .where(where)
    .orderBy(desc(schema.articles.publishedAt))
    .limit(limit)
    .offset(offset);

  c.header('Cache-Control', 'no-cache, no-store');
  return c.json(articles);
});

app.get('/grouped', async (c) => {
  const db = createDb(c.env.DB);

  const rows = await db
    .select({
      source: schema.sources,
      article: schema.articles,
    })
    .from(schema.sources)
    .leftJoin(
      schema.articles,
      eq(schema.articles.sourceId, schema.sources.id)
    )
    .where(eq(schema.sources.isActive, true))
    .orderBy(desc(schema.sources.priority), desc(schema.sources.createdAt), desc(schema.articles.publishedAt));

  const grouped = new Map<number, { source: typeof schema.sources.$inferSelect; articles: typeof schema.articles.$inferSelect[] }>();

  for (const row of rows) {
    const sourceId = row.source.id;
    if (!grouped.has(sourceId)) {
      grouped.set(sourceId, { source: row.source, articles: [] });
    }
    if (row.article) {
      grouped.get(sourceId)!.articles.push(row.article);
    }
  }

  const result = Array.from(grouped.values()).map((group) => ({
    source: group.source,
    articles: group.articles.slice(0, 10),
  }));

  c.header('Cache-Control', 'no-cache, no-store');
  return c.json(result);
});

export default app;
