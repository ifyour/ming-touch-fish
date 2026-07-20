import { Hono } from 'hono';
import { z } from 'zod';
import { getSessionUser } from '../session';
import type { Bindings } from '../types';

const app = new Hono<{ Bindings: Bindings }>();

const singleSchema = z.object({ articleId: z.number().int() });
const batchSchema = z.object({ articleIds: z.array(z.number().int()).max(1000) });

// 读取当前登录用户的已读文章 ID 列表。未登录返回 401，前端据此回退 localStorage。
app.get('/articles', async (c) => {
  const user = await getSessionUser(c.env, c.req.raw);
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const { results } = await c.env.DB.prepare('SELECT articleId FROM read_articles WHERE userId = ?')
    .bind(user.id)
    .all<{ articleId: number }>();

  return c.json({ articleIds: results.map((r) => r.articleId) });
});

// 单条标记已读（upsert，忽略唯一索引冲突）。
app.post('/articles', async (c) => {
  const user = await getSessionUser(c.env, c.req.raw);
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const parsed = singleSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid body' }, 400);

  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO read_articles (userId, articleId, readAt) VALUES (?, ?, ?)',
  )
    .bind(user.id, parsed.data.articleId, Date.now())
    .run();

  return c.json({ ok: true });
});

// 批量标记已读（「标记已读」整卡片用）。
app.post('/articles/batch', async (c) => {
  const user = await getSessionUser(c.env, c.req.raw);
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const parsed = batchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid body' }, 400);

  const now = Date.now();
  const statements = parsed.data.articleIds.map((id) =>
    c.env.DB.prepare(
      'INSERT OR IGNORE INTO read_articles (userId, articleId, readAt) VALUES (?, ?, ?)',
    ).bind(user.id, id, now),
  );
  await c.env.DB.batch(statements);

  return c.json({ ok: true });
});

export default app;
