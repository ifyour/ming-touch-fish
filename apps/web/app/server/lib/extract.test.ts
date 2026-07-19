import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractArticleText,
  extractArticleTextViaAmp,
  extractArticleTextViaBrowser,
  extractFromHtml,
} from './extract';

type MockResp = { ok: boolean; status: number; text: () => Promise<string> };
const mockResp = (ok: boolean, status: number, body: string): MockResp => ({
  ok,
  status,
  text: async () => body,
});

describe('extractFromHtml', () => {
  it('extracts main text content via Readability', () => {
    const html =
      '<html><body><article><p>Hello world this is the article body</p></article></body></html>';
    const text = extractFromHtml(html);
    expect(text).toContain('Hello world this is the article body');
  });

  it('falls back to stripping tags for fragment html', () => {
    const text = extractFromHtml('<p>plain text content here</p>');
    expect(text).toBe('plain text content here');
  });

  it('returns plain text unchanged when there are no tags', () => {
    expect(extractFromHtml('Hello world plain')).toBe('Hello world plain');
  });

  it('throws when no content can be extracted and strip fallback is disabled', () => {
    expect(() => extractFromHtml('   ', { allowStripFallback: false })).toThrow();
  });

  it('优先提取 JSON-LD 的 articleBody 而非可见层', () => {
    const html = `<html><body>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","articleBody":"这是从结构化数据拿到的完整正文内容，付费墙只遮挡了可见层。"}</script>
      <article><p>可见层只有一句话</p></article>
    </body></html>`;
    const text = extractFromHtml(html);
    expect(text).toContain('这是从结构化数据拿到的完整正文内容');
    expect(text).not.toContain('可见层只有一句话');
  });

  it('支持 @graph 嵌套的 articleBody', () => {
    const html = `<html><body>
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"NewsArticle","articleBody":"嵌套图谱里的正文"}]}</script>
    </body></html>`;
    const text = extractFromHtml(html);
    expect(text).toContain('嵌套图谱里的正文');
  });

  it('JSON-LD 缺失时不阻塞，回退到 Readability', () => {
    const html = '<html><body><article><p>普通文章正文在这里</p></article></body></html>';
    const text = extractFromHtml(html);
    expect(text).toContain('普通文章正文在这里');
  });

  it('单条 JSON-LD 解析失败不影响其他脚本', () => {
    const html = `<html><body>
      <script type="application/ld+json">{坏掉的 json</script>
      <script type="application/ld+json">{"articleBody":"第二条是好的正文"}</script>
    </body></html>`;
    const text = extractFromHtml(html);
    expect(text).toContain('第二条是好的正文');
  });

  it('JS 渲染页（SPA）的脚本壳被剔除，实时抓取模式应抛错而非返回噪声', () => {
    const html = `<!DOCTYPE html><html><head><title>Measuring Progress Toward AGI | Kaggle</title></head>
      <body>
        <script>window["pageRequestStartTime"] = 1784307427102; window.KAGGLE = {}; try{(function(a,s,y,n,c){var d=s.createElement("style");})()}</script>
        <script>window.initialData = JSON.parse('{"foo":1}'); document.getElementById("x").addEventListener("load",function(){});</script>
      </body></html>`;
    // 实时抓取关闭兜底：脚本壳被剔除后无可见正文，应抛错交由 RSS 回退，避免喂垃圾给 LLM
    expect(() => extractFromHtml(html, { allowStripFallback: false })).toThrow();
  });

  it('SPA 壳被剔除后若仍有可见正文，应只返回可见正文', () => {
    const html = `<html><body>
      <script>window.x = 1; function bootstrap(){ JSON.parse('{}'); }</script>
      <article><p>这是页面上真实可见的文章正文内容</p></article>
    </body></html>`;
    const text = extractFromHtml(html);
    expect(text).toContain('这是页面上真实可见的文章正文内容');
    expect(text).not.toContain('window.x');
    expect(text).not.toContain('JSON.parse');
  });
});

describe('extractArticleText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const articleHtml =
    '<html><body><article><p>这是一篇真实可见的文章正文，足够长以通过抽取校验阈值。</p></article></body></html>';
  const okResp = mockResp(true, 200, articleHtml);

  it('优先用 Googlebot UA 抓页，命中即返回正文', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit): Promise<MockResp> => {
      const ua = (init.headers as Record<string, string>)['user-agent'];
      // 只有 Googlebot 才放行（模拟付费墙对爬虫放开）
      return ua.includes('Googlebot') ? okResp : mockResp(false, 403, '');
    });
    vi.stubGlobal('fetch', fetchMock);

    const text = await extractArticleText('https://paywalled.example.com/a');
    expect(text).toContain('这是一篇真实可见的文章正文');
    const firstUa = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(firstUa['user-agent']).toContain('Googlebot');
  });

  it('Googlebot 失败时用普通浏览器 UA 兜底', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit): Promise<MockResp> => {
      const ua = (init.headers as Record<string, string>)['user-agent'];
      return ua.includes('Googlebot') ? mockResp(false, 403, '') : okResp;
    });
    vi.stubGlobal('fetch', fetchMock);

    const text = await extractArticleText('https://paywalled.example.com/a');
    expect(text).toContain('这是一篇真实可见的文章正文');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('两档 UA 都失败时不抛未定义错误', async () => {
    const fetchMock = vi.fn(async (): Promise<MockResp> => mockResp(false, 403, ''));
    vi.stubGlobal('fetch', fetchMock);

    await expect(extractArticleText('https://paywalled.example.com/a')).rejects.toThrow();
  });
});

describe('extractArticleTextViaAmp', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const ampHtml =
    '<html><body><article><p>AMP 版本完整正文，付费墙在这里被放开。</p></article></body></html>';
  const url = 'https://news.example.com/2024/story';

  it('为普通 URL 生成 /amp 与 ?amp=1、?outputType=amp 三种变体', () => {
    // 通过记录被请求 URL 验证变体生成（不依赖内部函数导出）
    const requested: string[] = [];
    const fetchMock = vi.fn(async (u: string): Promise<MockResp> => {
      requested.push(u);
      // 全部失败，仅用于收集请求 URL
      return mockResp(false, 404, '');
    });
    vi.stubGlobal('fetch', fetchMock);

    return extractArticleTextViaAmp(url).catch(() => {
      expect(requested).toContain('https://news.example.com/2024/story/amp');
      expect(requested).toContain('https://news.example.com/2024/story?amp=1');
      expect(requested).toContain('https://news.example.com/2024/story?outputType=amp');
    });
  });

  it('首个能抽到的 AMP 变体即被采用，不再请求后续变体', async () => {
    const fetchMock = vi.fn(async (u: string): Promise<MockResp> => {
      if (u.endsWith('/amp')) {
        return mockResp(true, 200, ampHtml);
      }
      return mockResp(false, 404, '');
    });
    vi.stubGlobal('fetch', fetchMock);

    const text = await extractArticleTextViaAmp(url);
    expect(text).toContain('AMP 版本完整正文');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('已带 amp 字样的 URL 不再重复拼接变体', async () => {
    const requested: string[] = [];
    const fetchMock = vi.fn(async (u: string): Promise<MockResp> => {
      requested.push(u);
      return mockResp(false, 404, '');
    });
    vi.stubGlobal('fetch', fetchMock);

    return extractArticleTextViaAmp('https://news.example.com/2024/story/amp').catch(() => {
      // 单变体 × 2 个回退 UA = 2 次请求，但都只是 /amp 这一个 URL，不再重复拼接其它变体
      expect(requested.length).toBe(2);
      expect(requested.every((u) => u === 'https://news.example.com/2024/story/amp')).toBe(true);
    });
  });

  it('所有 AMP 变体都失败时抛错', async () => {
    const fetchMock = vi.fn(async (): Promise<MockResp> => mockResp(false, 404, ''));
    vi.stubGlobal('fetch', fetchMock);

    await expect(extractArticleTextViaAmp(url)).rejects.toThrow();
  });
});

describe('extractArticleTextViaBrowser', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const mockFetch = (body: unknown, headers: Record<string, string> = {}) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        headers: { get: (k: string) => headers[k] ?? null },
        json: async () => body,
      })),
    );

  it('解析成功响应并返回截断后的正文与耗时', async () => {
    const longText = 'x'.repeat(9000);
    mockFetch(
      { success: true, result: `# Title\n\n${longText}` },
      { 'X-Browser-Ms-Used': '1176.5' },
    );

    const { text, msUsed } = await extractArticleTextViaBrowser(
      'token',
      'acct',
      'https://example.com/a',
    );

    expect(text.startsWith('# Title')).toBe(true);
    expect(text.length).toBe(8000);
    expect(msUsed).toBe(1176.5);
  });

  it('success 为 false 时抛错', async () => {
    mockFetch({ success: false, result: '' });
    await expect(
      extractArticleTextViaBrowser('token', 'acct', 'https://example.com/a'),
    ).rejects.toThrow('Browser Rendering 未能提取正文');
  });

  it('缺失 result 时抛错', async () => {
    mockFetch({ success: true });
    await expect(
      extractArticleTextViaBrowser('token', 'acct', 'https://example.com/a'),
    ).rejects.toThrow('Browser Rendering 未能提取正文');
  });

  it('读不到耗时响应头时 msUsed 为 null', async () => {
    mockFetch({ success: true, result: 'some markdown body' });
    const { msUsed } = await extractArticleTextViaBrowser('token', 'acct', 'https://example.com/a');
    expect(msUsed).toBeNull();
  });

  it('渲染结果是崩溃/错误页时抛错而非返回噪声正文', async () => {
    mockFetch({
      success: true,
      result:
        'Kaggle uses cookies from Google to deliver its services.\n\n###### Something went wrong and this page crashed!\n\nUnexpected token \'<\', "<!doctype "... is not valid JSON',
    });
    await expect(
      extractArticleTextViaBrowser('token', 'acct', 'https://kaggle.com/x'),
    ).rejects.toThrow('错误/崩溃页');
  });

  it('请求携带 Bearer token 与 JSON body', async () => {
    const fetchMock = vi.fn(async () => ({
      headers: { get: () => null },
      json: async () => ({ success: true, result: 'ok' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await extractArticleTextViaBrowser('my-token', 'acct-1', 'https://x.test/p');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct-1/browser-rendering/markdown',
    );
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer my-token');
    expect(JSON.parse(init.body as string)).toMatchObject({
      url: 'https://x.test/p',
      gotoOptions: { waitUntil: 'load', timeout: 15000 },
    });
  });
});
