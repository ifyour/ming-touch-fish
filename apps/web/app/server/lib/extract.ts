import { extractFromHtml, fetchWithUA, MAX_CHARS } from '@repo/shared';

export { extractFromHtml };

export async function extractArticleText(url: string): Promise<string> {
  const resp = await fetchWithUA(url);
  const html = await resp.text();
  return extractFromHtml(html, { allowStripFallback: false });
}

export interface BrowserExtractResult {
  text: string;
  msUsed: number | null;
}

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
      gotoOptions: { waitUntil: 'networkidle2', timeout: 30000 },
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
