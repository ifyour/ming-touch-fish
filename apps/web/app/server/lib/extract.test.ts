import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractArticleTextViaBrowser, extractFromHtml } from './extract';

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
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer my-token');
    expect(JSON.parse(init.body as string)).toMatchObject({
      url: 'https://x.test/p',
      gotoOptions: { waitUntil: 'networkidle2', timeout: 30000 },
    });
  });
});
