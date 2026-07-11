import { fetchWithUA } from '@repo/shared';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';

const MAX_CHARS = 8000;

export async function extractArticleText(url: string): Promise<string> {
  const resp = await fetchWithUA(url);
  const html = await resp.text();
  const { document } = parseHTML(html);
  const article = new Readability(document as unknown as Document).parse();
  const text = (article?.textContent ?? '').trim();
  if (!text) {
    throw new Error('未能从页面提取到正文');
  }
  return text.slice(0, MAX_CHARS);
}
