import type { FeedData } from '@extractus/feed-extractor';
import { logger } from '@repo/telemetry';
import { scrapePage } from './firecrawl.js';

const V2EX_FIRECRAWL_URL = 'https://v2ex.com/?';

type FeedEntry = NonNullable<FeedData['entries']>[number];
type EntryList = FeedEntry[];

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function parseV2exHotTopics(html: string): EntryList {
  const hotMatch = html.match(
    /<div\s+class="box"\s+id="TopicsHot">([\s\S]*?)(?=<div\s+class="box"[^>]*>|$)/,
  );
  if (!hotMatch) {
    logger.warn('V2EX hot topics section (#TopicsHot) not found in scraped HTML', { service: 'fetcher' });
    return [];
  }

  const hotHtml = hotMatch[1];
  const entries: FeedEntry[] = [];
  // Firecrawl converts relative links to absolute; direct fetch keeps them relative
  const itemRegex = /item_hot_topic_title">\s*<a\s+href="(?:https?:\/\/v2ex\.com)?(\/t\/(\d+))"[^>]*>([\s\S]*?)<\/a>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(hotHtml)) !== null) {
    const title = decodeHtmlEntities(match[3].trim());
    if (!title) continue;
    entries.push({
      id: `v2ex-hot-${match[2]}`,
      title,
      link: `https://v2ex.com${match[1]}`,
      published: new Date().toISOString(),
    });
  }

  return entries;
}

function isRssXml(body: string): boolean {
  return /^<\?xml|^<rss|^<feed|xmlns=/.test(body.trim().slice(0, 200));
}

export async function fetchV2exHotTopics(env: { FIRECRAWL_API_KEY: string }): Promise<FeedData> {
  if (!env.FIRECRAWL_API_KEY) {
    throw new Error('FIRECRAWL_API_KEY not configured');
  }

  logger.info('Fetching V2EX hot topics via Firecrawl', { service: 'fetcher' });

  // Use ? query param to force V2EX to serve HTML instead of negotiating RSS/XML
  const result = await scrapePage(V2EX_FIRECRAWL_URL, env.FIRECRAWL_API_KEY);
  if (isRssXml(result.html)) {
    throw new Error('Firecrawl returned RSS/XML instead of HTML');
  }

  const entries = parseV2exHotTopics(result.html);
  logger.info(`V2EX hot topics: parsed ${entries.length} entries`, { service: 'fetcher' });

  return {
    title: 'V2EX 热议',
    link: 'https://v2ex.com/',
    description: 'V2EX 今日热议主题',
    entries,
  };
}
