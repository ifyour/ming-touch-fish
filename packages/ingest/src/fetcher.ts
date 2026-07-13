import { extract, extractFromXml, type FeedData } from '@extractus/feed-extractor';
import { createDb, schema } from '@repo/db';
import {
  BROWSER_UA,
  fetchWithUA,
  isCloudflareQuotaError,
  isLatinText,
  normalizeUrl,
  SUMMARY_UAS,
  shouldFetchNow,
} from '@repo/shared';
import { logger } from '@repo/telemetry';
import { eq } from 'drizzle-orm';
import { articleExists } from './dedup.js';
import { translateTitles } from './translator.js';
import type { Env } from './types.js';
import { fetchV2exHotTopics } from './v2ex-adapter.js';

export async function getSourcesToFetch(db: D1Database) {
  const drizzle = createDb(db);
  const allSources = await drizzle
    .select()
    .from(schema.sources)
    .where(eq(schema.sources.isActive, true));

  return allSources.filter((source) => shouldFetchNow(source.fetchFrequency, source.lastFetchedAt));
}

export async function fetchAndStore(env: Env, sourceId: number): Promise<void> {
  const drizzle = createDb(env.DB);

  const source = await drizzle
    .select()
    .from(schema.sources)
    .where(eq(schema.sources.id, sourceId))
    .get();
  if (!source) {
    throw new Error(`Source not found: ${sourceId}`);
  }
  if (!source.isActive) {
    logger.warn(`Source ${source.id} is inactive, skipping`, {
      service: 'fetcher',
      sourceId: source.id,
    });
    return;
  }

  logger.info(`Fetching source: ${source.name}`, {
    service: 'fetcher',
    sourceId: source.id,
    url: source.url,
  });

  const UA = BROWSER_UA;
  const V2EX_API = 'https://www.v2ex.com/api/topics/latest.json';

  async function fetchFeed(url: string): Promise<FeedData> {
    if (url.includes('v2ex.com/index.xml')) {
      const topics = (await fetch(V2EX_API, {
        signal: AbortSignal.timeout(10000),
        headers: { 'user-agent': UA },
      }).then((r) => {
        if (!r.ok) throw new Error(`V2EX API: ${r.status}`);
        return r.json();
      })) as Array<Record<string, unknown>>;
      return {
        title: 'V2EX',
        link: 'https://v2ex.com/',
        description: 'V2EX 最新主题',
        entries: topics.slice(0, 20).map((t: Record<string, unknown>) => ({
          id: `v2ex-${t['id']}`,
          title: String(t['title'] ?? ''),
          link: `https://v2ex.com/t/${t['id']}`,
          published: t['created'] ? new Date(Number(t['created']) * 1000).toISOString() : undefined,
          description: t['content_rendered'] as string | undefined,
          content: t['content_rendered'] as string | undefined,
          author: (t['member'] as Record<string, unknown>)?.['username'] as string | undefined,
        })),
      };
    }

    if (url.includes('v2ex.com/#hot-topics')) {
      return await fetchV2exHotTopics(env);
    }

    const uas = SUMMARY_UAS;
    for (const ua of uas) {
      try {
        return await extract(
          url,
          {
            descriptionMaxLen: 500,
            getExtraEntryFields: (entry) => ({
              summary: entry['summary'] ?? entry['description'] ?? '',
              author: entry['author'] ?? entry['creator'] ?? '',
              categories: entry['categories'] ?? [],
              content: String(
                entry['content:encoded'] ?? entry['content'] ?? entry['content_rendered'] ?? '',
              ).slice(0, 8000),
            }),
          },
          { headers: { 'user-agent': ua }, signal: AbortSignal.timeout(10000) },
        );
      } catch (err) {
        logger.warn(`Extract failed for ${url} with UA [${ua.slice(0, 40)}...]`, {
          service: 'fetcher',
          sourceId,
          error: err,
        });
      }
    }
    const rawResp = await fetchWithUA(url);
    if (rawResp.ok) {
      const xml = await rawResp.text();
      return extractFromXml(xml, {
        descriptionMaxLen: 500,
        getExtraEntryFields: (entry) => ({
          summary: entry['summary'] ?? entry['description'] ?? '',
          author: entry['author'] ?? entry['creator'] ?? '',
          categories: entry['categories'] ?? [],
          content: String(
            entry['content:encoded'] ?? entry['content'] ?? entry['content_rendered'] ?? '',
          ).slice(0, 8000),
        }),
      });
    }
    logger.warn(`Fetch failed for ${url}: HTTP ${rawResp.status}`, {
      service: 'fetcher',
      sourceId,
    });
    throw new Error(`All fetch attempts failed for ${url}`);
  }

  const feed = await fetchFeed(source.url);

  if (!feed || !feed.entries || feed.entries.length === 0) {
    logger.info(`No entries found for source: ${source.name}`, {
      service: 'fetcher',
      sourceId: source.id,
    });
    await updateLastFetched(drizzle, source.id);
    return;
  }

  const sortedEntries = feed.entries
    .map((entry) => {
      const publishedTime = entry.published ? new Date(entry.published).getTime() : Date.now();
      return { ...entry, publishedTime };
    })
    .sort((a, b) => b.publishedTime - a.publishedTime);

  const pending: Array<{
    url: string;
    title: string;
    publishedTime: number;
    metadata: Record<string, unknown>;
  }> = [];
  let quotaError: string | null = null;

  for (const entry of sortedEntries) {
    if (quotaError) break;

    try {
      const url = normalizeUrl(entry.link ?? '');
      if (!url) continue;

      const exists = await articleExists(env.DB, url, source.id);
      if (exists) continue;

      const extra = entry as Record<string, unknown>;
      pending.push({
        url,
        title: entry.title ?? 'Untitled',
        publishedTime: entry.publishedTime,
        metadata: {
          description:
            (extra['summary'] as string | undefined) ??
            (extra['description'] as string | undefined) ??
            '',
          content:
            (extra['content'] as string | undefined) ??
            (extra['content_rendered'] as string | undefined) ??
            (extra['description'] as string | undefined) ??
            '',
          author:
            (extra['author'] as string | undefined) ??
            (extra['creator'] as string | undefined) ??
            '',
          categories: Array.isArray(extra['categories']) ? extra['categories'] : [],
        },
      });
    } catch (err) {
      const quotaMsg = isCloudflareQuotaError(err);
      if (quotaMsg) {
        quotaError = quotaMsg;
        break;
      }
      throw err;
    }
  }

  const latinIdx: number[] = [];
  const latinTitles: string[] = [];
  for (let i = 0; i < pending.length; i++) {
    if (isLatinText(pending[i].title)) {
      latinIdx.push(i);
      latinTitles.push(pending[i].title);
    }
  }

  const translated = await translateTitles(env, latinTitles);

  let stored = 0;
  for (let i = 0; i < pending.length; i++) {
    if (quotaError) break;

    try {
      await drizzle.insert(schema.articles).values({
        sourceId: source.id,
        title: pending[i].title,
        translatedTitle: translated[latinIdx.indexOf(i)] ?? null,
        url: pending[i].url,
        publishedAt: new Date(pending[i].publishedTime),
        metadata: pending[i].metadata,
      });
      stored++;
    } catch (err) {
      const quotaMsg = isCloudflareQuotaError(err);
      if (quotaMsg) {
        quotaError = quotaMsg;
        logger.error(`Quota limit reached after storing ${stored} articles: ${quotaMsg}`, {
          service: 'fetcher',
          sourceId: source.id,
          error: err,
        });
        break;
      }
      throw err;
    }
  }

  const deduped = sortedEntries.length - pending.length;
  if (quotaError) {
    logger.info(
      `[${source.name}] Partial: ${stored} stored, ${deduped} dedup'd, ${pending.length - stored} remaining (quota: ${quotaError})`,
      {
        service: 'fetcher',
        sourceId: source.id,
        stored,
        skipped: deduped,
        total: sortedEntries.length,
        quotaError,
      },
    );
  } else {
    logger.info(
      `[${source.name}] Complete: ${stored} stored, ${deduped} dedup'd out of ${sortedEntries.length} entries`,
      {
        service: 'fetcher',
        sourceId: source.id,
        stored,
        skipped: deduped,
        total: sortedEntries.length,
      },
    );
  }

  await updateLastFetched(drizzle, source.id);
}

async function updateLastFetched(drizzle: ReturnType<typeof createDb>, sourceId: number) {
  await drizzle
    .update(schema.sources)
    .set({ lastFetchedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.sources.id, sourceId));
}
