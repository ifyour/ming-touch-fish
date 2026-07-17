import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

export const MAX_CHARS = 8000;

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
}

function collectArticleBody(node: unknown, out: string[]): void {
  if (typeof node === 'string') {
    if (node.trim()) out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectArticleBody(item, out);
    return;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (typeof obj.articleBody === 'string' && obj.articleBody.trim()) {
      out.push(obj.articleBody);
    }
    if (obj['@graph']) collectArticleBody(obj['@graph'], out);
    for (const key of Object.keys(obj)) {
      if (key === 'articleBody' || key === '@graph') continue;
      const val = obj[key];
      if (val && typeof val === 'object') collectArticleBody(val, out);
    }
  }
}

function extractJsonLd(html: string): string | null {
  try {
    const { document } = parseHTML(html);
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    const bodies: string[] = [];
    for (const script of Array.from(scripts)) {
      const raw = (script as unknown as { textContent?: string }).textContent;
      if (!raw) continue;
      try {
        collectArticleBody(JSON.parse(raw), bodies);
      } catch {
        // 单条 JSON-LD 解析失败不影响其他
      }
    }
    if (bodies.length === 0) return null;
    const text = clean(bodies.join(' '));
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export function extractFromHtml(html: string, opts: { allowStripFallback?: boolean } = {}): string {
  const allowStripFallback = opts.allowStripFallback ?? true;

  // 优先读 JSON-LD 的 articleBody：多数媒体站为 SEO 把全文塞进结构化数据，
  // 而前端付费墙 JS 只遮挡可见层，故 JSON-LD 能拿到完整正文。
  const jsonLd = extractJsonLd(html);
  if (jsonLd) return jsonLd;

  // 剔除 JS/样式块：JS 渲染页（SPA）的正文全靠前端脚本，服务端 HTML 里的
  // <script> 仅含 bootstrap/JSON 噪声。若不剔除，Readability 会把脚本壳当正文。
  // 只移除 <script>/<style> 块、保留其余标签，让 Readability 在真实 DOM 上解析；
  // 若一并去标签成纯文本再喂给 Readability，linkedom 解析出的 documentElement 为
  // null，Readability 会直接抛错，导致所有 live 实时抓取的正文抽取失效。
  const domHtml = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');

  // 其次用 Readability（在剔除脚本后的 DOM 上效果最好）
  try {
    const { document } = parseHTML(domHtml);
    if (document?.documentElement) {
      const article = new Readability(document as unknown as Document).parse();
      if (article?.textContent?.trim()) {
        return article.textContent.trim().slice(0, MAX_CHARS);
      }
    }
  } catch {
    // Readability 解析失败，走下方保底
  }

  // 保底用：剔除脚本/样式后的可见纯文本（仅用于 RSS 片段等本就无完整 DOM 的场景）
  const cleaned = domHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 实时抓取的页面若 Readability 取不到正文，应抛错交由 RSS 回退，
  // 否则去标签兜底会把 JS 渲染页的 shell 当正文，绕过 RSS 回退并缓存垃圾。
  if (!allowStripFallback) {
    throw new Error('未能从页面提取到正文');
  }

  // 保底：剔除脚本后的可见纯文本（仅用于 RSS 片段等本就无完整 DOM 的场景）
  const text = cleaned;
  if (!text) {
    throw new Error('未能从 HTML 提取到正文');
  }
  return text.slice(0, MAX_CHARS);
}
