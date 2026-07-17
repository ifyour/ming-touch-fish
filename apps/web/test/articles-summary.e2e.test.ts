import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function clearAll() {
  await env.DB.prepare('DELETE FROM articles').run();
  await env.DB.prepare('DELETE FROM sources').run();
}

async function seedArticle(opts: {
  url: string;
  metadata?: Record<string, unknown>;
}): Promise<number> {
  const { url, metadata } = opts;
  const now = Math.floor(Date.now() / 1000);
  const insert = await env.DB.prepare(
    `INSERT INTO sources (name, url, priority, fetch_frequency, is_active, created_at, updated_at)
     VALUES (?, ?, 1, 'daily', 1, ?, ?)`,
  )
    .bind('Src', 'https://src.test', now, now)
    .run();
  const sourceId = Number(insert.meta.last_row_id);
  const metaInsert = await env.DB.prepare(
    `INSERT INTO articles (source_id, title, url, published_at, fetched_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(sourceId, 'T', url, now, now, metadata ? JSON.stringify(metadata) : null)
    .run();
  return Number(metaInsert.meta.last_row_id);
}

// mock fetch：Browser API 走 controlled 响应，文章抓取 URL 一律抛错（模拟反爬失败）。
function mockFetch(browserResponse: unknown) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/browser-rendering/markdown')) {
      return {
        headers: { get: () => null },
        json: async () => browserResponse,
      };
    }
    throw new Error('mock article fetch failed (anti-bot)');
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('GET /api/articles/:id/summary 第四层 Browser Rendering', () => {
  beforeEach(async () => {
    await clearAll();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('第四层触发失败时写 summaryFailedAt 失败缓存', async () => {
    const id = await seedArticle({ url: 'https://paywall.test/article' });
    const fetchMock = mockFetch({ success: false, result: '' });

    const res = await SELF.fetch(`https://localhost/api/articles/${id}/summary`);
    expect(res.status).toBe(422);
    // 第四层应被触发（Browser API 被调用 1 次）
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/browser-rendering/'),
      expect.anything(),
    );

    const row = (await env.DB.prepare('SELECT metadata FROM articles WHERE id = ?')
      .bind(id)
      .first()) as { metadata: string } | null;
    const failedAt = row ? JSON.parse(row.metadata).summaryFailedAt : undefined;
    expect(typeof failedAt).toBe('number');
  });

  it('24h 失败缓存期内不再调用 Browser 渲染', async () => {
    const id = await seedArticle({
      url: 'https://paywall.test/article2',
      metadata: { summaryFailedAt: Date.now() - 1000 },
    });
    const fetchMock = mockFetch({ success: true, result: 'x'.repeat(200) });

    const res = await SELF.fetch(`https://localhost/api/articles/${id}/summary`);
    expect(res.status).toBe(422);
    // recentlyFailed 拦截，Browser API 不应被调用
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/browser-rendering/'),
      expect.anything(),
    );
  });

  it('前三层已拿到正文时不触发第四层', async () => {
    const id = await seedArticle({
      url: 'https://ok.test/article',
      metadata: {
        content:
          '这是一段足够长的正文内容，用于通过 isContentSufficient 的字数与有效字符占比校验。'.repeat(
            5,
          ),
      },
    });
    const fetchMock = mockFetch({ success: true, result: 'x'.repeat(200) });

    const res = await SELF.fetch(`https://localhost/api/articles/${id}/summary`);
    // 前三层靠 metadata.content 命中，第四层不应触发
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/browser-rendering/'),
      expect.anything(),
    );
    // 走到 GEMINI 阶段（env 有 GEMINI_API_KEY），mock 返回非预期结构 → 500
    expect(res.status).toBe(500);
  });
});
