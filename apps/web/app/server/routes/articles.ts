import { createDb, schema } from '@repo/db';
import { STALE_GROUP_DAYS } from '@repo/shared';
import { logger } from '@repo/telemetry';
import { desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { extractArticleText, extractFromHtml } from '../lib/extract';
import { InsufficientContentError, isContentSufficient, summarizeArticle } from '../lib/summarize';
import type { Bindings } from '../types';

const ARTICLES_PER_SOURCE = 20;

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

app.get('/:id/summary', async (c) => {
  const db = createDb(c.env.DB);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) {
    return c.json({ error: 'invalid article id' }, 400);
  }

  const row = await db
    .select({
      summary: schema.articles.summary,
      url: schema.articles.url,
      metadata: schema.articles.metadata,
    })
    .from(schema.articles)
    .where(eq(schema.articles.id, id))
    .get();

  if (!row) {
    return c.json({ error: 'article not found' }, 404);
  }
  if (row.summary) {
    return c.json({ summary: row.summary, cached: true });
  }

  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'GEMINI_API_KEY 未配置' }, 500);
  }

  try {
    let text: string | null = null;
    let source: 'live' | 'rss-content' | 'rss-desc' | null = null;

    // 1. 直接抓取文章 URL → Readability（取不到正文会抛错，交由下方 RSS 回退）
    try {
      text = await extractArticleText(row.url);
      source = 'live';
    } catch (err) {
      logger.warn('文章总结实时抓取失败，回退 RSS 正文', {
        service: 'web-api',
        articleId: id,
        error: err instanceof Error ? err.message : err,
      });
      text = null;
    }

    // 2. 回退到 RSS 正文（getExtraEntryFields 采集的 content）
    if (!text || !isContentSufficient(text)) {
      const content = (row.metadata as Record<string, unknown> | undefined)?.content as
        | string
        | undefined;
      if (content) {
        try {
          const t = extractFromHtml(content);
          if (isContentSufficient(t)) {
            text = t;
            source = 'rss-content';
          }
        } catch {
          // ignore, try next fallback
        }
      }
    }

    // 3. 回退到 RSS 简介（description / 摘要）
    if (!text || !isContentSufficient(text)) {
      const desc = (row.metadata as Record<string, unknown> | undefined)?.description as
        | string
        | undefined;
      if (desc) {
        try {
          const t = extractFromHtml(desc);
          if (isContentSufficient(t)) {
            text = t;
            source = 'rss-desc';
          }
        } catch {
          // ignore
        }
      }
    }

    if (!text || !isContentSufficient(text)) {
      throw new InsufficientContentError();
    }

    if (source !== 'live') {
      logger.info('文章总结使用 RSS 回退生成', { service: 'web-api', articleId: id, source });
    }

    const summary = await summarizeArticle(text, apiKey);
    await db.update(schema.articles).set({ summary }).where(eq(schema.articles.id, id));
    return c.json({ summary, cached: false });
  } catch (err) {
    if (err instanceof InsufficientContentError) {
      logger.warn('文章总结三级回退均失败', { service: 'web-api', articleId: id });
      return c.json({ error: err.message }, 422);
    }
    logger.error('文章总结失败', { service: 'web-api', articleId: id, error: err });
    const message = err instanceof Error ? err.message : '总结生成失败';
    return c.json({ error: message }, 500);
  }
});

app.get('/grouped', async (c) => {
  const db = createDb(c.env.DB);

  // scope=stale 仅返回较慢更新的过期源（懒加载）；其余（含默认）返回活跃源。
  const wantStale = c.req.query('scope') === 'stale';

  // 先按源聚合最新文章发布时间，用于服务端判定过期，避免把过期源的文章也捞进首页初始查询。
  // MAX(publishedAt) 走 articles_source_published_idx 索引高效得出，不需扫描文章行；
  // 此处一并带上 source 整行（仅服务端内存使用，不下发），后续per源取文章时直接复用，避免每个源再发一次源查询。
  // 注意：Drizzle 的 timestamp 模式在库中按「秒」存储，这里乘 1000 还原为毫秒再与 Date.now() 比较。
  const sourceRows = await db
    .select({
      source: schema.sources,
      newestMs: sql<number | null>`CAST(MAX(${schema.articles.publishedAt}) AS INTEGER) * 1000`,
    })
    .from(schema.sources)
    .leftJoin(schema.articles, eq(schema.articles.sourceId, schema.sources.id))
    .where(eq(schema.sources.isActive, true))
    .groupBy(schema.sources.id);

  const threshold = STALE_GROUP_DAYS * 24 * 60 * 60 * 1000;
  const staleIds = sourceRows
    .filter((r) => r.newestMs == null || Date.now() - r.newestMs > threshold)
    .map((r) => r.source.id);

  const activeIds = sourceRows.map((r) => r.source.id).filter((id) => !staleIds.includes(id));

  const relevantIds = wantStale ? staleIds : activeIds;

  // 提示前端是否存在可懒加载的过期源（仅在活跃查询时下发）。
  if (!wantStale) {
    c.header('X-Has-Stale', staleIds.length > 0 ? 'true' : 'false');
  }

  if (relevantIds.length === 0) {
    c.header('Cache-Control', 'public, max-age=60');
    return c.json([]);
  }

  // 逐源取「最新 ARTICLES_PER_SOURCE 篇」：每个源一次索引查询（LIMIT 20，1 个绑定参数），
  // 既不走窗口函数 row_number() 的全量扫描，也不把所有文章 id 拼进一个超长 IN 列表（会触发 D1 参数上限）。
  // 源信息直接复用上面聚合得到的 sourceRows，避免每个源再发一次源查询。
  const perSource = await Promise.all(
    relevantIds.map(async (sid) => {
      const source = sourceRows.find((r) => r.source.id === sid)?.source;
      const articles = await db
        .select({
          id: schema.articles.id,
          sourceId: schema.articles.sourceId,
          title: schema.articles.title,
          translatedTitle: schema.articles.translatedTitle,
          url: schema.articles.url,
          summary: schema.articles.summary,
          publishedAt: schema.articles.publishedAt,
          fetchedAt: schema.articles.fetchedAt,
        })
        .from(schema.articles)
        .where(eq(schema.articles.sourceId, sid))
        .orderBy(desc(schema.articles.publishedAt))
        .limit(ARTICLES_PER_SOURCE);
      return { source, articles };
    }),
  );

  const result = perSource
    .filter((x) => x.source)
    .map((x) => ({ source: x.source!, articles: x.articles }))
    .sort(
      (a, b) =>
        b.source.priority - a.source.priority ||
        (a.source.createdAt?.getTime() ?? 0) - (b.source.createdAt?.getTime() ?? 0),
    );

  c.header('Cache-Control', 'public, max-age=60');
  return c.json(result);
});

export default app;
