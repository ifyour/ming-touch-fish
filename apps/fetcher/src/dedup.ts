import { eq } from 'drizzle-orm';
import { createDb, schema } from '@repo/db';

export async function articleExists(db: D1Database, url: string): Promise<boolean> {
  const drizzle = createDb(db);
  const existing = await drizzle
    .select({ id: schema.articles.id })
    .from(schema.articles)
    .where(eq(schema.articles.url, url))
    .get();

  return existing !== undefined;
}
