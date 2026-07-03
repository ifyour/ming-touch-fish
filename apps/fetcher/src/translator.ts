import { logger } from '@repo/telemetry';
import type { Env } from './types.js';

const SYSTEM_PROMPT =
  'Translate the English tech article titles into natural Chinese. Rules: (1) Keep Cloudflare product names untranslated: Workers, Durable Objects, R2, KV, D1, Turnstile, Queues, Cron Triggers, Email Workers, Analytics Engine, Secrets, Environments, AI Gateway, Vectorize. (2) Keep other English brand/product names when that sounds more natural. (3) Input is a JSON array of strings. (4) Respond with ONLY a JSON array of strings in the same order.';

const MAX_BATCH_SIZE = 30;

export async function translateTitle(env: Env, title: string): Promise<string> {
  try {
    const response = await env.AI.run('@cf/zai-org/glm-4.7-flash', {
      messages: [
        {
          role: 'system',
          content: SYSTEM_PROMPT,
        },
        { role: 'user', content: JSON.stringify([title]) },
      ],
    });

    if (
      response &&
      typeof response === 'object' &&
      'response' in response &&
      typeof response.response === 'string'
    ) {
      const parsed = JSON.parse(response.response.trim());
      if (Array.isArray(parsed) && typeof parsed[0] === 'string') {
        return parsed[0];
      }
    }
  } catch (err) {
    logger.error('Translation failed, falling back to original title', { service: 'fetcher', error: err });
  }

  return title;
}

export async function translateTitles(env: Env, titles: string[]): Promise<(string | null)[]> {
  if (titles.length === 0) return [];
  if (titles.length === 1) {
    const t = await translateTitle(env, titles[0]);
    return [t];
  }

  const results: (string | null)[] = [];

  for (let i = 0; i < titles.length; i += MAX_BATCH_SIZE) {
    const batch = titles.slice(i, i + MAX_BATCH_SIZE);
    try {
      const response = await env.AI.run('@cf/zai-org/glm-4.7-flash', {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(batch) },
        ],
      });

      if (
        response &&
        typeof response === 'object' &&
        'response' in response &&
        typeof response.response === 'string'
      ) {
        const parsed = JSON.parse(response.response.trim());
        if (Array.isArray(parsed) && parsed.length === batch.length && parsed.every((s: unknown) => typeof s === 'string')) {
          results.push(...(parsed as string[]));
          continue;
        }
      }
    } catch (err) {
      logger.warn('Batch translation failed, falling back to individual', { service: 'fetcher', error: err });
    }

    const fallback = await Promise.all(batch.map((t) => translateTitle(env, t)));
    results.push(...fallback);
  }

  return results;
}
