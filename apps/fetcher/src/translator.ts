import { logger } from '@repo/telemetry';
import type { Env } from './types.js';

const SYSTEM_PROMPT =
  'Translate the English tech article titles into natural Chinese. Rules: (1) Keep Cloudflare product names untranslated: Workers, Durable Objects, R2, KV, D1, Turnstile, Queues, Cron Triggers, Email Workers, Analytics Engine, Secrets, Environments, AI Gateway, Vectorize. (2) Keep other English brand/product names when that sounds more natural. (3) Output ONLY translations, one per line, in the same order as input. No extra text.';

const BATCH_MAX = 10;

export async function translateTitle(env: Env, title: string): Promise<string> {
  try {
    const response = await env.AI.run('@cf/zai-org/glm-4.7-flash', {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: title },
      ],
    });

    if (
      response &&
      typeof response === 'object' &&
      'response' in response &&
      typeof response.response === 'string'
    ) {
      return response.response.trim();
    }
  } catch (err) {
    logger.error('Translation failed, falling back to original title', { service: 'fetcher', error: err });
  }

  return title;
}

export async function translateTitles(env: Env, titles: string[]): Promise<(string | null)[]> {
  if (titles.length === 0) return [];

  const results: (string | null)[] = [];

  for (let i = 0; i < titles.length; i += BATCH_MAX) {
    const batch = titles.slice(i, i + BATCH_MAX);
    try {
      const response = await env.AI.run('@cf/zai-org/glm-4.7-flash', {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: batch.join('\n') },
        ],
      });

      if (
        response &&
        typeof response === 'object' &&
        'response' in response &&
        typeof response.response === 'string'
      ) {
        const lines = response.response.trim().split('\n');
        if (lines.length === batch.length && lines.every((s) => s.length > 0)) {
          results.push(...lines);
          continue;
        }
      }
    } catch (err) {
      logger.warn('Batch translation failed, falling back to individual', { service: 'fetcher', error: err });
    }

    for (const t of batch) {
      results.push(await translateTitle(env, t));
    }
  }

  return results;
}
