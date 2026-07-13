import { createDb, schema } from '@repo/db';
import { and, eq } from 'drizzle-orm';

export async function articleExists(
  db: D1Database,
  url: string,
  sourceId: number,
): Promise<boolean> {
  const drizzle = createDb(db);
  const existing = await drizzle
    .select({ id: schema.articles.id })
    .from(schema.articles)
    .where(and(eq(schema.articles.url, url), eq(schema.articles.sourceId, sourceId)))
    .get();

  return existing !== undefined;
}
