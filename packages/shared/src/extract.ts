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
  // <script> 仅含 bootstrap/JSON 噪声。若不剔除，Readability/去标签会把脚本壳
  // 当正文喂给 LLM，生成「页面崩溃/JSON 解析错误」之类的幻觉并污染缓存。
  // 用正则移除所有 <script>/<style> 块（JSON-LD 已被上面的 extractJsonLd 单独消费，
  // 此处无需保留），避免依赖 querySelectorAll(':not()') 在不同运行时（workerd vs Node）的兼容性差异。
  const cleaned = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 其次用 Readability（在剔除脚本后的 DOM 上效果最好）
  try {
    const { document } = parseHTML(cleaned);
    if (document?.body) {
      const article = new Readability(document as unknown as Document).parse();
      if (article?.textContent) {
        return article.textContent.trim().slice(0, MAX_CHARS);
      }
    }
  } catch {
    // Readability 对纯文本抛异常，走下方保底
  }

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
