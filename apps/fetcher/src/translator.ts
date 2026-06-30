import type { Env } from './types.js';

export async function translateTitle(env: Env, title: string): Promise<string> {
  try {
    const response = await env.AI.run('@cf/meta/m2m100-1.2b', {
      text: title,
      source_lang: 'en',
      target_lang: 'zh',
    });

    if (
      response &&
      typeof response === 'object' &&
      'translated_text' in response &&
      typeof response.translated_text === 'string'
    ) {
      return response.translated_text;
    }
  } catch (err) {
    console.error('Translation failed, falling back to original title:', err);
  }

  return title;
}
