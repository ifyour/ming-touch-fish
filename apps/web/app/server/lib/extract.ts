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
  return { text: data.result.trim().slice(0, MAX_CHARS), msUsed };
}
