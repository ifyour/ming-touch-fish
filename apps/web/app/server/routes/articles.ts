import { createDb, schema } from '@repo/db';
import { STALE_GROUP_DAYS } from '@repo/shared';
import { logger } from '@repo/telemetry';
import { desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { extractArticleText, extractArticleTextViaBrowser, extractFromHtml } from '../lib/extract';
import { InsufficientContentError, isContentSufficient, summarizeArticle } from '../lib/summarize';
import type { Bindings } from '../types';

const INITIAL_PER_SOURCE = 10;
const PAGE_SIZE = 10;
const SUMMARY_FAIL_TTL = 24 * 60 * 60 * 1000;

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
    return c.json({ summary: row.summary, cached: true, stage: 'cached' as const });
  }

  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'GEMINI_API_KEY 未配置' }, 500);
  }

  type Stage = 'live' | 'rss-content' | 'rss-desc' | 'browser' | 'gemini' | 'cached';
  let stage: Stage = 'live';

  const STAGE_LABEL: Record<Stage, string> = {
    live: '实时抓取文章页',
    'rss-content': '读取 RSS 正文',
    'rss-desc': '读取 RSS 简介',
    browser: 'Browser Rendering 渲染抓取',
    gemini: '调用 Gemini 生成总结',
    cached: '命中缓存',
  };

  try {
    let text: string | null = null;
    let source: 'live' | 'rss-content' | 'rss-desc' | 'browser' | null = null;

    // 1. 直接抓取文章 URL → Readability（取不到正文会抛错，交由下方 RSS 回退）
    try {
      stage = 'live';
      text = await extractArticleText(row.url);
      source = 'live';
    } catch (err) {
      logger.warn('文章总结实时抓取失败，回退 RSS 正文', {
        service: 'web-api',
        articleId: id,
        stage,
        error: err instanceof Error ? err.message : err,
      });
      text = null;
    }

    // 2. 回退到 RSS 正文：优先用 fetcher 预抽的纯文本 fullContent（直接读库，零出站），
    // 其次回退到 RSS content HTML 现抽。
    if (!text || !isContentSufficient(text)) {
      stage = 'rss-content';
      const meta = row.metadata as Record<string, unknown> | undefined;
      const fullContent = meta?.fullContent as string | undefined;
      const content = meta?.content as string | undefined;
      if (fullContent) {
        if (isContentSufficient(fullContent)) {
          text = fullContent;
          source = 'rss-content';
        }
      } else if (content) {
        try {
          const t = extractFromHtml(content);
          if (isContentSufficient(t)) {
            text = t;
            source = 'rss-content';
          }
        } catch {
          // 正文不足，回退下一级
        }
      }
    }

    // 3. 回退到 RSS 简介（description / 摘要）
    if (!text || !isContentSufficient(text)) {
      stage = 'rss-desc';
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
          // 正文不足
        }
      }
    }

    // 4. 第四层：Browser Rendering 真浏览器渲染（治「实时抓取被反爬但内容免费」的源）。
    // 触发条件：前三级全失败 + 配置了 CLOUDFLARE_API_TOKEN/ACCOUNT_ID 时每次都尝试。
    // 注：Pages Functions 不支持 Browser 绑定，改用 Browser Run REST API（free 计划每天 10 分钟，超出仅限流不扣费，不影响其他功能）。
    // 不跳过：即便该文章近期失败过也仍尝试，超出免费额度仅返回限流错误，无实质影响；每次进入均记日志以保证观测性。
    if (
      (!text || !isContentSufficient(text)) &&
      c.env.CLOUDFLARE_API_TOKEN &&
      c.env.CLOUDFLARE_ACCOUNT_ID
    ) {
      const meta = row.metadata as Record<string, unknown> | undefined;
      const failedAt = meta?.summaryFailedAt as number | undefined;
      const recentlyFailed =
        typeof failedAt === 'number' && Date.now() - failedAt < SUMMARY_FAIL_TTL;
      logger.info('文章总结进入 Browser Rendering 第四步', {
        service: 'web-api',
        articleId: id,
        url: row.url,
        recentlyFailed,
      });
      try {
        stage = 'browser';
        const { text: t, msUsed } = await extractArticleTextViaBrowser(
          c.env.CLOUDFLARE_API_TOKEN,
          c.env.CLOUDFLARE_ACCOUNT_ID,
          row.url,
        );
        if (isContentSufficient(t)) {
          text = t;
          source = 'browser';
          logger.info('文章总结使用 Browser Rendering 生成', {
            service: 'web-api',
            articleId: id,
            source: 'browser',
            browserMsUsed: msUsed,
          });
        } else {
          logger.warn('文章总结 Browser Rendering 未取到充足正文', {
            service: 'web-api',
            articleId: id,
          });
        }
      } catch (err) {
        logger.warn('文章总结 Browser Rendering 抓取失败', {
          service: 'web-api',
          articleId: id,
          stage,
          error: err instanceof Error ? err.message : err,
        });
      }
    }

    if (!text || !isContentSufficient(text)) {
      const reason =
        !text || text.trim().length === 0
          ? '所有来源都没有可用的正文内容'
          : '抽取到的正文太短或有效内容过少';
      throw new InsufficientContentError(reason);
    }

    if (source !== 'live') {
      logger.info('文章总结使用回退来源生成', { service: 'web-api', articleId: id, source });
    }

    // 成功观测：返回实际命中正文的阶段（live / rss-content / rss-desc / browser），
    // 与失败路径的 stage 字段保持一致口径，便于成功失败统一排查。
    const sourceStage: Stage = source ?? 'live';
    stage = 'gemini';
    const summary = await summarizeArticle(text, apiKey);
    await db.update(schema.articles).set({ summary }).where(eq(schema.articles.id, id));
    return c.json({ summary, cached: false, stage: sourceStage });
  } catch (err) {
    if (err instanceof InsufficientContentError) {
      // 彻底失败：记最近失败时间，仅用于日志观测（recentlyFailed），不再据此跳过第四步。
      const prevMeta = (row.metadata as Record<string, unknown> | undefined) ?? {};
      await db
        .update(schema.articles)
        .set({ metadata: { ...prevMeta, summaryFailedAt: Date.now() } })
        .where(eq(schema.articles.id, id));
      logger.warn('文章总结四级回退均失败', { service: 'web-api', articleId: id, stage });
      return c.json(
        {
          error: '文章正文获取失败，暂时无法生成总结',
          stage,
          detail: `最后一步「${STAGE_LABEL[stage]}」失败：${err.message}`,
        },
        422,
      );
    }
    logger.error('文章总结失败', { service: 'web-api', articleId: id, error: err, stage });
    const message = err instanceof Error ? err.message : '总结生成失败';
    return c.json(
      {
        error: '总结生成失败，请稍后重试',
        stage,
        detail: `「${STAGE_LABEL[stage]}」出错：${message}`,
      },
      500,
    );
  }
});

const GROUP_SELECT = {
  id: schema.articles.id,
  sourceId: schema.articles.sourceId,
  title: schema.articles.title,
  translatedTitle: schema.articles.translatedTitle,
  url: schema.articles.url,
  summary: schema.articles.summary,
  publishedAt: schema.articles.publishedAt,
  fetchedAt: schema.articles.fetchedAt,
} as const;

async function fetchSourceArticles(
  db: ReturnType<typeof createDb>,
  sourceId: number,
  limit: number,
  offset: number,
) {
  return db
    .select(GROUP_SELECT)
    .from(schema.articles)
    .where(eq(schema.articles.sourceId, sourceId))
    .orderBy(desc(schema.articles.publishedAt))
    .limit(limit)
    .offset(offset);
}

app.get('/grouped', async (c) => {
  const db = createDb(c.env.DB);

  // 单源分页加载：前端点「Show more」或滚动到底部时，带上 sourceId + offset 只取该源的下一批文章。
  // 返回结构与普通 grouped 一致（单个元素的数组），前端直接 concat 即可。
  const sourceIdParam = c.req.query('sourceId');
  if (sourceIdParam) {
    const sourceId = Number(sourceIdParam);
    if (!Number.isInteger(sourceId)) {
      return c.json({ error: 'invalid sourceId' }, 400);
    }
    const offset = Math.max(0, Number(c.req.query('offset') ?? '0'));
    const limit = Math.min(Math.max(1, Number(c.req.query('limit') ?? String(PAGE_SIZE))), 50);
    const source = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.id, sourceId))
      .get();
    if (!source) {
      return c.json({ error: 'source not found' }, 404);
    }
    const articles = await fetchSourceArticles(db, sourceId, limit, offset);
    c.header('Cache-Control', 'no-store');
    c.header('X-Has-More', articles.length >= limit ? 'true' : 'false');
    return c.json([{ source, articles }]);
  }

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
      total: sql<number>`COUNT(${schema.articles.id})`,
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

  // 逐源取「最新 INITIAL_PER_SOURCE 篇」：每个源一次索引查询（LIMIT 10，1 个绑定参数），
  // 既不走窗口函数 row_number() 的全量扫描，也不把所有文章 id 拼进一个超长 IN 列表（会触发 D1 参数上限）。
  // 源信息直接复用上面聚合得到的 sourceRows，避免每个源再发一次源查询。
  // 首页初始只取 10 条，剩余文章由前端点「Show more」/滚动到底部时分批按需拉取，进一步压低 D1 读配额。
  const perSource = await Promise.all(
    relevantIds.map(async (sid) => {
      const row = sourceRows.find((r) => r.source.id === sid);
      const source = row?.source;
      const articles = await fetchSourceArticles(db, sid, INITIAL_PER_SOURCE, 0);
      return { source, articles, total: Number(row?.total ?? 0) };
    }),
  );

  const result = perSource
    .filter((x) => x.source)
    .map((x) => ({ source: x.source!, articles: x.articles, total: x.total }))
    .sort(
      (a, b) =>
        b.source.priority - a.source.priority ||
        (a.source.createdAt?.getTime() ?? 0) - (b.source.createdAt?.getTime() ?? 0),
    );

  c.header('Cache-Control', 'public, max-age=60');
  return c.json(result);
});

export default app;
