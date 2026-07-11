import type { FeedData } from '@extractus/feed-extractor';
import { logger } from '@repo/telemetry';
import { scrapePage } from './firecrawl.js';

const V2EX_FIRECRAWL_URL = 'https://v2ex.com/?';

type FeedEntry = NonNullable<FeedData['entries']>[number];
// FeedEntry 类型未声明 content/description，但运行期需要携带正文供文章总结回退使用
type HotEntry = FeedEntry & { content?: string; description?: string };
type EntryList = HotEntry[];

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
  const now = Date.now();

  while ((match = itemRegex.exec(hotHtml)) !== null) {
    const title = decodeHtmlEntities(match[3].trim());
    if (!title) continue;
    entries.push({
      id: `v2ex-hot-${match[2]}`,
      title,
      link: `https://v2ex.com${match[1]}`,
      published: new Date(now - entries.length * 1000).toISOString(),
    });
  }

  return entries;
}

function isRssXml(body: string): boolean {
  return /^<\?xml|^<rss|^<feed|xmlns=/.test(body.trim().slice(0, 200));
}

const V2EX_TOPIC_API = 'https://www.v2ex.com/api/topics/show.json?id=';
const TOPIC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// 热议条目在首页 #TopicsHot 里只有标题与链接，没有正文。为让文章总结
// （/api/articles/:id/summary）的 RSS 正文回退可用，这里用 V2EX API 补全每条
// 主题的正文 content_rendered；否则总结只能依赖请求时实时抓取话题页，在 dev /
// 受限网络下会稳定 422。抓取失败则跳过，回退到实时抓取。
async function fetchTopicContent(id: string): Promise<string | undefined> {
  try {
    const resp = await fetch(`${V2EX_TOPIC_API}${id}`, {
      signal: AbortSignal.timeout(10000),
      headers: { 'user-agent': TOPIC_UA },
    });
    if (!resp.ok) return undefined;
    const data = (await resp.json()) as Array<Record<string, unknown>>;
    return (data?.[0]?.content_rendered as string | undefined) ?? undefined;
  } catch (err) {
    logger.warn(`V2EX topic content fetch failed for ${id}`, { service: 'fetcher', error: err });
    return undefined;
  }
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

  // 并行补全每条主题正文，把耗时从「N×单条超时」压到「单条超时」级别。
  // 仅补全正文级 content（供总结 tier2 回退），不写 description，保留
  // tier2（正文级）/ tier3（摘要级）的语义区分；热议源无独立摘要可用。
  await Promise.all(
    entries.map(async (entry) => {
      const topicId = String(entry.id).replace(/^v2ex-hot-/, '');
      const rendered = await fetchTopicContent(topicId);
      if (rendered) {
        entry.content = rendered;
      }
    }),
  );

  return {
    title: 'V2EX 热议',
    link: 'https://v2ex.com/',
    description: 'V2EX 今日热议主题',
    entries,
  };
}
