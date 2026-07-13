import { Readability } from '@mozilla/readability';
import { fetchWithUA } from '@repo/shared';
import { parseHTML } from 'linkedom';

const MAX_CHARS = 8000;

export function extractFromHtml(html: string, opts: { allowStripFallback?: boolean } = {}): string {
  const allowStripFallback = opts.allowStripFallback ?? true;
  // 优先用 Readability（全文 HTML 效果最好）
  try {
    const { document } = parseHTML(html);
    if (document?.body) {
      const article = new Readability(document as unknown as Document).parse();
      if (article?.textContent) {
        return article.textContent.trim().slice(0, MAX_CHARS);
      }
    }
  } catch {
    // Readability 对 HTML 片段/纯文本抛异常，走下方保底
  }
  // 实时抓取的页面若 Readability 取不到正文，应抛错交由 RSS 回退，
  // 否则去标签兜底会把 JS 渲染页的 shell 当正文，绕过 RSS 回退并缓存垃圾。
  if (!allowStripFallback) {
    throw new Error('未能从页面提取到正文');
  }
  // 保底：去 HTML 标签取纯文本（仅用于 RSS 片段等本就无完整 DOM 的场景）
  const text = html.replace(/<[^>]+>/g, '').trim();
  if (!text) {
    throw new Error('未能从 HTML 提取到正文');
  }
  return text.slice(0, MAX_CHARS);
}

export async function extractArticleText(url: string): Promise<string> {
  const resp = await fetchWithUA(url);
  const html = await resp.text();
  return extractFromHtml(html, { allowStripFallback: false });
}
