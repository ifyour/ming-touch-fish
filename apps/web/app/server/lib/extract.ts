import { extractFromHtml, fetchWithUA, MAX_CHARS, PAYWALL_UAS } from '@repo/shared';

export { extractFromHtml };

/**
 * 付费墙友好的实时正文抽取：先用真爬虫 UA（Googlebot/bingbot）抓页，
 * 多数媒体站对搜索引擎放开全文本；若失败再用普通浏览器 UA 兜底。
 * 两档 UA 都拿不到则抛错，交由上层（RSS 回退 / Browser 渲染）接管。
 */
export async function extractArticleText(url: string): Promise<string> {
  let lastErr: unknown;
  for (const uas of [PAYWALL_UAS, undefined]) {
    try {
      const resp = uas ? await fetchWithUA(url, undefined, uas) : await fetchWithUA(url);
      const html = await resp.text();
      return extractFromHtml(html, { allowStripFallback: false });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error(`All fetch attempts failed for ${url}`);
}

/**
 * 付费墙常对 AMP 版本放开（/amp、?amp=1、?outputType=amp），故 live 抓到挑战页
 * 或正文不足时，再试 AMP 变体。返回首个能抽到的正文，全失败抛最后一条错误。
 */
export async function extractArticleTextViaAmp(url: string): Promise<string> {
  const ampVariants = buildAmpVariants(url);
  let lastErr: unknown;
  for (const variant of ampVariants) {
    try {
      const resp = await fetchWithUA(variant);
      const html = await resp.text();
      return extractFromHtml(html, { allowStripFallback: false });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error(`All AMP fetch attempts failed for ${url}`);
}

function buildAmpVariants(url: string): string[] {
  try {
    const u = new URL(url);
    // 已带 amp 字样直接返回原样，不再拼接
    if (/(\/amp\b|amp=1|outputType=amp)/i.test(u.pathname + u.search)) {
      return [url];
    }
    const variants: string[] = [];
    // 路径后缀 /amp（含已有尾部斜杠归一）
    const pathBase = u.pathname.replace(/\/$/, '');
    variants.push(`${u.origin}${pathBase}/amp${u.search}`);
    // query 参数变体
    variants.push(
      `${u.origin}${u.pathname}?amp=1${u.search ? `&${u.search.replace(/^\?/, '')}` : ''}`,
    );
    variants.push(
      `${u.origin}${u.pathname}?outputType=amp${u.search ? `&${u.search.replace(/^\?/, '')}` : ''}`,
    );
    return variants;
  } catch {
    return [];
  }
}

export interface BrowserExtractResult {
  text: string;
  msUsed: number | null;
}

export { ERROR_PAGE_MARKERS, looksLikeErrorPage };

export async function extractArticleTextViaBrowser(
  apiToken: string,
  accountId: string,
  url: string,
): Promise<BrowserExtractResult> {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/markdown`;
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify({
      url,
      // 正文 markdown 提取不需要等所有异步资源：networkidle2 对挂满广告/追踪脚本的站点
      // 会等很久，吃 Browser 免费时长（每天 10 分钟）。改 load + 较短超时即足够。
      gotoOptions: { waitUntil: 'load', timeout: 15000 },
    }),
  });
  const msUsedHeader = resp.headers.get('X-Browser-Ms-Used');
  const msUsed = msUsedHeader ? Number(msUsedHeader) : null;
  const data = (await resp.json()) as { success?: boolean; result?: string };
  if (!data.success || !data.result) {
    throw new Error('Browser Rendering 未能提取正文');
  }
  const text = data.result.trim().slice(0, MAX_CHARS);
  // 浏览器渲染可能拿到「页面崩溃 / JS 报错」式的错误页（如 Kaggle 讨论页 SPA 崩溃，
  // 正文只剩 "Something went wrong and this page crashed!" + SyntaxError 堆栈）。这类
  // 噪声若当正文喂给 LLM 会生成幻觉总结并污染缓存，故在此判定为无效、抛错交路由回退到 422。
  if (looksLikeErrorPage(text)) {
    throw new Error('Browser Rendering 拿到的是错误/崩溃页，非正文');
  }
  return { text, msUsed };
}

const ERROR_PAGE_MARKERS = [
  'something went wrong and this page crashed',
  'this page crashed',
  'is not valid json',
  'unexpected token',
  'enable javascript and cookies to continue',
  'checking your browser',
  'verify you are human',
  'access denied',
];

function looksLikeErrorPage(text: string): boolean {
  const lower = text.toLowerCase();
  // 命中任一崩溃/拦截特征即视为错误页（长度不足由上层 isContentSufficient 判定）
  return ERROR_PAGE_MARKERS.some((m) => lower.includes(m));
}
