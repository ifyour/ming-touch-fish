import { logger } from '@repo/telemetry';
import type { Env } from './types.js';

const DEEPL_TIMEOUT = 15000;
const BATCH_MAX = 50;

interface DeepLResponse {
  translations?: Array<{ detected_source_language?: string; text?: string }>;
  message?: string;
}

function getDeeplEndpoint(apiKey: string): string {
  return apiKey.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';
}

async function callDeepL(env: Env, texts: string[]): Promise<(string | null)[]> {
  if (texts.length === 0) return [];

  try {
    const response = await fetch(getDeeplEndpoint(env.DEEPL_API_KEY), {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${env.DEEPL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: texts, target_lang: 'ZH' }),
      signal: AbortSignal.timeout(DEEPL_TIMEOUT),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger.error('DeepL API error', {
        service: 'fetcher',
        status: response.status,
        statusText: response.statusText,
        body: body.slice(0, 200),
      });
      return new Array(texts.length).fill(null);
    }

    const data = (await response.json()) as DeepLResponse;
    const translations = data.translations ?? [];
    return texts.map((_, i) => translations[i]?.text?.trim() || null);
  } catch (err) {
    logger.error('DeepL request failed', { service: 'fetcher', error: err });
    return new Array(texts.length).fill(null);
  }
}

export async function translateTitle(env: Env, title: string): Promise<string | null> {
  const results = await callDeepL(env, [title]);
  return results[0] ?? null;
}

export async function translateTitles(env: Env, titles: string[]): Promise<(string | null)[]> {
  if (titles.length === 0) return [];

  const results: (string | null)[] = [];

  for (let i = 0; i < titles.length; i += BATCH_MAX) {
    const batch = titles.slice(i, i + BATCH_MAX);
    const batchResults = await callDeepL(env, batch);
    results.push(...batchResults);
  }

  return results;
}
