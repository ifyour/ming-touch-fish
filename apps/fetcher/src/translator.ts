import { logger } from '@repo/telemetry';
import type { Env } from './types.js';

export async function translateTitle(env: Env, title: string): Promise<string> {
  try {
    const response = await env.AI.run('@cf/zai-org/glm-4.7-flash', {
      messages: [
        {
          role: 'system',
          content:
            'Translate the English tech article title into natural Chinese. Rules: (1) Keep Cloudflare product names untranslated: Workers, Durable Objects, R2, KV, D1, Turnstile, Queues, Cron Triggers, Email Workers, Analytics Engine, Secrets, Environments, AI Gateway, Vectorize. (2) Keep other English brand/product names when that sounds more natural. (3) Output ONLY the translation, no explanation.',
        },
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
