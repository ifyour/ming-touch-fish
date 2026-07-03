import { extract, extractFromXml, type FeedData } from '@extractus/feed-extractor';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@repo/db';
import { normalizeUrl, isLatinText, shouldFetchNow, isCloudflareQuotaError } from '@repo/shared';
import { logger } from '@repo/telemetry';
import type { Env } from './types.js';
import { articleExists } from './dedup.js';
import { translateTitle } from './translator.js';

export async function getSourcesToFetch(db: D1Database) {
  const drizzle = createDb(db);
  const allSources = await drizzle.select().from(schema.sources).where(eq(schema.sources.isActive, true));

  return allSources.filter((source) => shouldFetchNow(source.fetchFrequency, source.lastFetchedAt));
}

export async function fetchAndStore(env: Env, sourceId: number): Promise<void> {
  const drizzle = createDb(env.DB);

  const source = await drizzle.select().from(schema.sources).where(eq(schema.sources.id, sourceId)).get();
  if (!source) {
    throw new Error(`Source not found: ${sourceId}`);
  }
  if (!source.isActive) {
    logger.warn(`Source ${source.id} is inactive, skipping`, { service: 'fetcher', sourceId: source.id });
    return;
  }

  logger.info(`Fetching source: ${source.name}`, { service: 'fetcher', sourceId: source.id, url: source.url });

  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  const V2EX_API = 'https://www.v2ex.com/api/topics/latest.json';

  async function fetchFeed(url: string): Promise<FeedData> {
    if (url.includes('v2ex.com/index.xml')) {
      const topics = await fetch(V2EX_API, {
        signal: AbortSignal.timeout(10000),
        headers: { 'user-agent': UA },
      }).then(r => { if (!r.ok) throw new Error(`V2EX API: ${r.status}`); return r.json(); }) as Array<Record<string, unknown>>;
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
          author: (t['member'] as Record<string, unknown>)?.['username'] as string | undefined,
        })),
      };
    }

    const uas = [UA, 'Mozilla/5.0 (compatible; Feedfetcher-Google; +http://www.google.com/feedfetcher.html)'];
    for (const ua of uas) {
      try {
        return await extract(url, {
          descriptionMaxLen: 500,
          getExtraEntryFields: (entry) => ({
            summary: entry['summary'] ?? entry['description'] ?? '',
            author: entry['author'] ?? entry['creator'] ?? '',
            categories: entry['categories'] ?? [],
          }),
        }, { headers: { 'user-agent': ua }, signal: AbortSignal.timeout(10000) });
      } catch (err) {
        logger.warn(`Extract failed for ${url} with UA [${ua.slice(0, 40)}...]`, { service: 'fetcher', sourceId, error: err });
      }
    }
    for (const ua of uas) {
      const resp = await fetch(url, { headers: { 'user-agent': ua }, signal: AbortSignal.timeout(10000) });
      if (resp.ok) {
        const xml = await resp.text();
        return extractFromXml(xml, {
          descriptionMaxLen: 500,
          getExtraEntryFields: (entry) => ({
            summary: entry['summary'] ?? entry['description'] ?? '',
            author: entry['author'] ?? entry['creator'] ?? '',
            categories: entry['categories'] ?? [],
          }),
        });
      }
      logger.warn(`Fetch failed for ${url} with UA [${ua.slice(0, 40)}...]: HTTP ${resp.status}`, { service: 'fetcher', sourceId });
    }
    throw new Error(`All fetch attempts failed for ${url}`);
  }

  const feed = await fetchFeed(source.url);

  if (!feed || !feed.entries || feed.entries.length === 0) {
    logger.info(`No entries found for source: ${source.name}`, { service: 'fetcher', sourceId: source.id });
    await updateLastFetched(drizzle, source.id);
    return;
  }

  const sortedEntries = feed.entries
    .map((entry) => {
      const publishedTime = entry.published ? new Date(entry.published).getTime() : Date.now();
      return { ...entry, publishedTime };
    })
    .sort((a, b) => b.publishedTime - a.publishedTime);

  let stored = 0;
  let skipped = 0;
  let quotaError: string | null = null;

  for (const entry of sortedEntries) {
    if (quotaError) break;

    try {
      const url = normalizeUrl(entry.link ?? '');
      if (!url) continue;

      const exists = await articleExists(env.DB, url);
      if (exists) {
        skipped++;
        continue;
      }

      const title = entry.title ?? 'Untitled';
      const translatedTitle = isLatinText(title) ? await translateTitle(env, title) : null;

      const extra = entry as Record<string, unknown>;
      const metadata = {
        description:
          (extra['summary'] as string | undefined) ?? (extra['description'] as string | undefined) ?? '',
        author: (extra['author'] as string | undefined) ?? (extra['creator'] as string | undefined) ?? '',
        categories: Array.isArray(extra['categories']) ? extra['categories'] : [],
      };

      await drizzle.insert(schema.articles).values({
        sourceId: source.id,
        title,
        translatedTitle,
        url,
        publishedAt: new Date(entry.publishedTime),
        metadata,
      });

      stored++;
    } catch (err) {
      const quotaMsg = isCloudflareQuotaError(err);
      if (quotaMsg) {
        quotaError = quotaMsg;
        logger.error(`Quota limit reached after storing ${stored} articles: ${quotaMsg}`, { service: 'fetcher', sourceId: source.id, error: err });
        break;
      }
      throw err;
    }
  }

  if (quotaError) {
    logger.info(
      `[${source.name}] Partial: ${stored} stored, ${skipped} dedup'd, ${sortedEntries.length - stored - skipped} remaining (quota: ${quotaError})`,
      { service: 'fetcher', sourceId: source.id, stored, skipped, total: sortedEntries.length, quotaError }
    );
  } else {
    logger.info(
      `[${source.name}] Complete: ${stored} stored, ${skipped} dedup'd out of ${sortedEntries.length} entries`,
      { service: 'fetcher', sourceId: source.id, stored, skipped, total: sortedEntries.length }
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
