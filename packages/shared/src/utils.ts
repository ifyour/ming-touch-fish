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
