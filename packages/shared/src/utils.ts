/**
 * Normalize a URL for deduplication by stripping common tracking parameters.
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const trackingParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'fbclid',
      'gclid',
      'ref',
      'source',
    ];
    for (const param of trackingParams) {
      u.searchParams.delete(param);
    }
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Heuristic to detect if a string is primarily Latin characters.
 */
export function isLatinText(text: string): boolean {
  if (!text || text.length === 0) return false;
  const latinCount = (text.match(/[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/g) ?? []).length;
  return latinCount / text.length > 0.6;
}

/**
 * Determine whether a source should be fetched now based on its frequency and last fetch time.
 */
function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  return new Date(v);
}

export function shouldFetchNow(
  frequency: 'hourly' | 'twice_daily' | 'daily',
  lastFetchedAt: Date | string | null | undefined
): boolean {
  const d = toDate(lastFetchedAt);
  if (!d) return true;

  const now = Date.now();
  const elapsed = now - d.getTime();

  const intervals = {
    hourly: 60 * 60 * 1000,
    twice_daily: 12 * 60 * 60 * 1000,
    daily: 24 * 60 * 60 * 1000,
  };

  return elapsed >= intervals[frequency];
}

/**
 * Detect Cloudflare Workers quota/limit errors and return a user-facing message.
 * Returns null if the error is not quota-related (transient errors, bugs, etc.).
 */
export function isCloudflareQuotaError(err: unknown): string | null {
  if (!(err instanceof Error)) return null;
  const msg = err.message;
  const code = (err as any)?.code;

  if (code === 1101 || /cpu time/i.test(msg)) {
    return 'Cloudflare Workers CPU time quota exceeded (free tier: 10ms). Some articles were processed before timeout. Try reducing fetch frequency or upgrading your plan.';
  }
  if (code === 1027 || /\bsubrequest\b/i.test(msg)) {
    return 'Cloudflare Workers subrequest quota exceeded (free tier: 50 per request). Some articles were processed before the limit. Try reducing fetch frequency.';
  }
  if (/429|too many requests/i.test(msg)) {
    return 'API rate limit exceeded. Please try again later.';
  }
  if (/D1_ERROR|SQLITE_BUSY|database.*(?:quota|limit|exceed)/i.test(msg)) {
    return 'D1 database quota exceeded (free tier: 5M read units / 50k write units per day). Articles saved so far are stored; remaining will be retried next cycle.';
  }
  if (/AI.*(?:quota|limit|rate|exceed)/i.test(msg) || /quota.*ai/i.test(msg)) {
    return 'Workers AI daily quota exceeded. Articles were saved without Chinese title translation. Translation will resume when quota resets.';
  }
  if (code === 402 || /402|payment required/i.test(msg)) {
    return 'Third-party API credits exhausted (402). Please top up your account or reduce fetch frequency.';
  }

  return null;
}

const STALE_GROUP_DAYS = 30;

/**
 * 判定一个资讯源是否应被收起：最新文章 publishedAt 距今超过 STALE_GROUP_DAYS 天（或无文章）即视为过期。
 * 用于首页「加载更多」折叠区块。
 */
export function isStaleGroup(
  group: { articles: { publishedAt: Date | string | null | undefined }[] }
): boolean {
  if (group.articles.length === 0) return true;
  const newest = group.articles.reduce((max, a) => {
    const d = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    return Math.max(max, d);
  }, 0);
  if (!newest) return true;
  return Date.now() - newest > STALE_GROUP_DAYS * 24 * 60 * 60 * 1000;
}

const FEED_PATH_RE = /\.(rss|xml|atom|json)$|\/(feed|rss|atom|feeds?)$/i;
const FEED_SUBDOMAIN_RE = /^(feed|feeds|rss|atom)$/i;

/**
 * 从订阅源 URL 推导其站点主页链接：剥离 .rss/.xml/.atom 等 feed 路径与查询参数，
 * 并去掉 feed 类的子域（如 feed.appinn.com → appinn.com），仅保留 origin + 目录路径（用于卡片标题跳转）。
 */
export function getSourceHomepage(feedUrl: string): string {
  try {
    const u = new URL(feedUrl);
    let path = u.pathname;
    if (FEED_PATH_RE.test(path)) {
      const idx = path.lastIndexOf('/');
      path = path.slice(0, idx);
    }
    let host = u.host;
    const parts = host.split('.');
    if (parts.length > 2 && FEED_SUBDOMAIN_RE.test(parts[0])) {
      parts.shift();
      host = parts.join('.');
    }
    return `${u.protocol}//${host}${path === '/' ? '' : path || '/'}`;
  } catch {
    return feedUrl;
  }
}

/**
 * Format a date relative to now (e.g. "2 hours ago").
 */
export function formatRelativeTime(date: Date | string | null | undefined): string {
  const d = toDate(date);
  if (!d) return '';
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}
