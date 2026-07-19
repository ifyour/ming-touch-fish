import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchWithUA,
  formatRelativeTime,
  getSourceHomepage,
  isCloudflareQuotaError,
  isLatinText,
  isStaleByNewestPublishedAt,
  isStaleGroup,
  normalizeUrl,
  PAYWALL_UAS,
  shouldFetchNow,
} from './utils';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('normalizeUrl', () => {
  it('strips tracking params but keeps the rest', () => {
    expect(normalizeUrl('https://example.com/post?utm_source=x&fbclid=y&id=1')).toBe(
      'https://example.com/post?id=1',
    );
  });

  it('removes ref and source params', () => {
    expect(normalizeUrl('https://example.com/p?ref=abc&source=news')).toBe('https://example.com/p');
  });

  it('keeps non-tracking query params', () => {
    expect(normalizeUrl('https://example.com/p?page=2')).toBe('https://example.com/p?page=2');
  });

  it('returns the original string for invalid urls', () => {
    expect(normalizeUrl('not a url')).toBe('not a url');
  });
});

describe('isLatinText', () => {
  it('returns false for empty input', () => {
    expect(isLatinText('')).toBe(false);
    expect(isLatinText('   ')).toBe(false);
  });

  it('returns true for pure latin text', () => {
    expect(isLatinText('Hello World')).toBe(true);
  });

  it('returns false for pure CJK text', () => {
    expect(isLatinText('你好世界')).toBe(false);
  });

  it('returns false when latin ratio is below threshold', () => {
    expect(isLatinText('世界世界世界Hello')).toBe(false);
  });

  it('returns true when latin ratio exceeds 0.6', () => {
    expect(isLatinText('世界 Hello')).toBe(true);
  });
});

describe('shouldFetchNow', () => {
  it('fetches immediately when never fetched', () => {
    expect(shouldFetchNow('daily', null)).toBe(true);
    expect(shouldFetchNow('hourly', undefined)).toBe(true);
  });

  it('respects the hourly interval', () => {
    expect(shouldFetchNow('hourly', new Date(Date.now() - 30 * MINUTE))).toBe(false);
    expect(shouldFetchNow('hourly', new Date(Date.now() - 2 * HOUR))).toBe(true);
  });

  it('respects the twice_daily interval', () => {
    expect(shouldFetchNow('twice_daily', new Date(Date.now() - 11 * HOUR))).toBe(false);
    expect(shouldFetchNow('twice_daily', new Date(Date.now() - 13 * HOUR))).toBe(true);
  });

  it('respects the daily interval', () => {
    expect(shouldFetchNow('daily', new Date(Date.now() - 23 * HOUR))).toBe(false);
    expect(shouldFetchNow('daily', new Date(Date.now() - 25 * HOUR))).toBe(true);
  });

  it('accepts ISO string and Date inputs', () => {
    expect(shouldFetchNow('daily', new Date(Date.now() - 25 * HOUR).toISOString())).toBe(true);
  });
});

describe('isCloudflareQuotaError', () => {
  it('returns null for non-Error values', () => {
    expect(isCloudflareQuotaError('boom')).toBeNull();
  });

  it('returns null for unrelated errors', () => {
    expect(isCloudflareQuotaError(new Error('something else'))).toBeNull();
  });

  it('detects CPU time quota (code 1101)', () => {
    expect(isCloudflareQuotaError(Object.assign(new Error(''), { code: 1101 }))).not.toBeNull();
  });

  it('detects CPU time quota (message)', () => {
    expect(isCloudflareQuotaError(new Error('CPU time exceeded'))).not.toBeNull();
  });

  it('detects subrequest quota (code 1027)', () => {
    expect(isCloudflareQuotaError(Object.assign(new Error(''), { code: 1027 }))).not.toBeNull();
  });

  it('detects subrequest quota (message)', () => {
    expect(isCloudflareQuotaError(new Error('subrequest limit hit'))).not.toBeNull();
  });

  it('detects 429 rate limit', () => {
    expect(isCloudflareQuotaError(new Error('429 Too Many Requests'))).not.toBeNull();
  });

  it('detects D1 quota', () => {
    expect(isCloudflareQuotaError(new Error('D1_ERROR: database quota exceeded'))).not.toBeNull();
  });

  it('detects AI quota', () => {
    expect(isCloudflareQuotaError(new Error('Workers AI quota exceeded'))).not.toBeNull();
  });

  it('detects 402 payment required', () => {
    expect(
      isCloudflareQuotaError(Object.assign(new Error('payment required'), { code: 402 })),
    ).not.toBeNull();
    expect(isCloudflareQuotaError(new Error('402 Payment Required'))).not.toBeNull();
  });
});

describe('isStaleByNewestPublishedAt', () => {
  it('treats missing timestamps as stale', () => {
    expect(isStaleByNewestPublishedAt(null)).toBe(true);
    expect(isStaleByNewestPublishedAt(undefined)).toBe(true);
    expect(isStaleByNewestPublishedAt('')).toBe(true);
    expect(isStaleByNewestPublishedAt(NaN)).toBe(true);
  });

  it('treats articles older than 30 days as stale', () => {
    expect(isStaleByNewestPublishedAt(new Date(Date.now() - 31 * DAY))).toBe(true);
  });

  it('treats recent articles as not stale', () => {
    expect(isStaleByNewestPublishedAt(new Date(Date.now() - 29 * DAY))).toBe(false);
  });

  it('treats exactly 30 days as not stale (strict greater-than)', () => {
    expect(isStaleByNewestPublishedAt(Date.now() - 30 * DAY)).toBe(false);
  });
});

describe('isStaleGroup', () => {
  it('treats empty groups as stale', () => {
    expect(isStaleGroup({ articles: [] })).toBe(true);
  });

  it('treats groups with only old articles as stale', () => {
    expect(isStaleGroup({ articles: [{ publishedAt: new Date(Date.now() - 40 * DAY) }] })).toBe(
      true,
    );
  });

  it('treats groups with recent articles as not stale', () => {
    expect(isStaleGroup({ articles: [{ publishedAt: new Date(Date.now() - 10 * DAY) }] })).toBe(
      false,
    );
  });
});

describe('getSourceHomepage', () => {
  it('strips a feed file path', () => {
    expect(getSourceHomepage('https://example.com/feed.xml')).toBe('https://example.com/');
    expect(getSourceHomepage('https://example.com/blog/feed')).toBe('https://example.com/blog');
  });

  it('strips a feed subdomain', () => {
    expect(getSourceHomepage('https://feed.appinn.com/rss')).toBe('https://appinn.com/');
  });

  it('leaves ordinary sites untouched', () => {
    expect(getSourceHomepage('https://example.com/')).toBe('https://example.com');
  });

  it('returns the input for invalid urls', () => {
    expect(getSourceHomepage('not a url')).toBe('not a url');
  });
});

describe('formatRelativeTime', () => {
  it('returns empty for missing dates', () => {
    expect(formatRelativeTime(null)).toBe('');
    expect(formatRelativeTime(undefined)).toBe('');
  });

  it('formats recent times', () => {
    expect(formatRelativeTime(new Date())).toBe('刚刚');
    expect(formatRelativeTime(new Date(Date.now() - 5 * MINUTE))).toBe('5 分钟前');
    expect(formatRelativeTime(new Date(Date.now() - 2 * HOUR))).toBe('2 小时前');
    expect(formatRelativeTime(new Date(Date.now() - 3 * DAY))).toBe('3 天前');
  });
});

describe('PAYWALL_UAS', () => {
  it('包含真爬虫 UA（Googlebot / bingbot）', () => {
    expect(PAYWALL_UAS.some((ua) => ua.includes('Googlebot'))).toBe(true);
    expect(PAYWALL_UAS.some((ua) => ua.includes('bingbot'))).toBe(true);
  });
});

describe('fetchWithUA', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const okResp = { ok: true, text: async () => '<p>正文</p>' };
  const failResp = { ok: false, status: 403, text: async () => '' };

  it('默认用 SUMMARY_UAS 列表逐 UA 回退', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(failResp); // 第一个 UA 失败
    fetchMock.mockResolvedValueOnce(okResp); // 第二个 UA 成功
    vi.stubGlobal('fetch', fetchMock);

    const resp = await fetchWithUA('https://example.com/a');
    expect(resp).toBe(okResp);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('接受覆盖 UA 列表参数', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      // 仅当命中指定的 Googlebot UA 时才成功，验证覆盖列表真的被用上
      const ua = (init.headers as Record<string, string>)['user-agent'];
      return ua.includes('Googlebot') ? okResp : failResp;
    });
    vi.stubGlobal('fetch', fetchMock);

    const resp = await fetchWithUA('https://example.com/a', undefined, PAYWALL_UAS);
    expect(resp).toBe(okResp);
    const firstUa = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(firstUa['user-agent']).toContain('Googlebot');
  });

  it('所有 UA 都失败时才抛出最后一条错误', async () => {
    const fetchMock = vi.fn(async () => failResp);
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchWithUA('https://example.com/a', undefined, PAYWALL_UAS)).rejects.toThrow(
      'HTTP 403',
    );
    expect(fetchMock).toHaveBeenCalledTimes(PAYWALL_UAS.length);
  });
});
