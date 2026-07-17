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

  // 剔除 JS/样式：JS 渲染页（SPA）的正文全靠前端脚本，服务端 HTML 里的
  // <script> 仅含 bootstrap/JSON 噪声。若不剔除，Readability/去标签会把脚本壳
  // 当正文喂给 LLM，生成「页面崩溃/JSON 解析错误」之类的幻觉并污染缓存。
  // application/ld+json 已由 extractJsonLd 单独消费，此处一并移除避免重复计入。
  const { document } = parseHTML(html);
  try {
    if (document?.querySelectorAll) {
      for (const el of Array.from(
        document.querySelectorAll('script:not([type="application/ld+json"]), style'),
      )) {
        el.remove();
      }
    }
  } catch {
    // 纯文本 / 残缺片段解析无 DOM，跳过脚本剔除
  }

  // 其次用 Readability（全文 HTML 效果最好）
  try {
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

  // 保底：去 HTML 标签取纯文本（仅用于 RSS 片段 / 无完整 DOM 的纯文本场景）。
  // 优先用已剔除脚本的 DOM 正文；若解析后无 body（如裸片段 / 纯文本），退回对原串去标签。
  let visible = '';
  try {
    visible = document?.body?.textContent ?? '';
  } catch {
    // linkedom 对纯文本输入访问 body 会抛错，忽略后用原串兜底
  }
  const text = (visible || html).replace(/<[^>]+>/g, '').trim();
  if (!text) {
    throw new Error('未能从 HTML 提取到正文');
  }
  return text.slice(0, MAX_CHARS);
}
