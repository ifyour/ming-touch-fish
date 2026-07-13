import { fetchWithUA } from '@repo/shared';
import { logger } from '@repo/telemetry';
import { Hono } from 'hono';
import { parseHTML } from 'linkedom';
import type { Bindings } from '../types';

const app = new Hono<{ Bindings: Bindings }>();

// favicon 不常变化，边缘缓存 7 天，从源头压低对源站的抓取与 Cloudflare 子请求配额。
const CACHE_TTL = 60 * 60 * 24 * 7;

interface FaviconCandidate {
  rel: string;
  href: string;
}

// 从主页 HTML 解析 favicon 链接：优先取小尺寸 favicon（rel=icon / shortcut icon），
// 跳过 apple-touch-icon 等大图与 mask-icon；找不到则返回 null，由调用方回退 /favicon.ico。
function findFaviconHref(homepage: URL, html: string): string | null {
  try {
    const { document } = parseHTML(html);
    const links = Array.from(document.querySelectorAll('link[rel]')) as Array<{
      getAttribute: (n: string) => string | null;
    }>;

    const icons: FaviconCandidate[] = [];
    for (const link of links) {
      const rel = (link.getAttribute('rel') || '').toLowerCase().trim();
      const href = link.getAttribute('href');
      if (rel && href && /\bicon\b/.test(rel)) {
        icons.push({ rel, href });
      }
    }
    if (icons.length === 0) return null;

    const small =
      icons.find(
        (c) => c.rel === 'icon' || c.rel === 'shortcut icon' || c.rel === 'alternate icon',
      ) ?? icons.find((c) => !c.rel.includes('apple-touch') && !c.rel.includes('mask'));
    const chosen = small ?? icons[0];
    return new URL(chosen.href, homepage).toString();
  } catch {
    return null;
  }
}

async function fetchIcon(iconUrl: string): Promise<Response | null> {
  try {
    const resp = await fetchWithUA(iconUrl);
    if (!resp.ok) return null;
    const ct = resp.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) return null;
    return resp;
  } catch {
    return null;
  }
}

// 先试 /favicon.ico（最快最稳，命中大多数站点，即「原网站的小灰标」），
// 失败再解析主页 HTML 中的 <link rel="icon">（覆盖自定义路径 / SVG 等）。
async function resolveFavicon(homepage: URL): Promise<Response | null> {
  // 快路径：大多数站点直接提供 /favicon.ico，仅 1 次子请求。
  const fallback = new URL('/favicon.ico', homepage).toString();
  const resp = await fetchIcon(fallback);
  if (resp) return resp;

  // 兜底：抓主页 HTML 找自定义图标的 <link rel="icon">。
  try {
    const hResp = await fetchWithUA(homepage.toString());
    const html = await hResp.text();
    const href = findFaviconHref(homepage, html);
    if (href) return fetchIcon(href);
  } catch (err) {
    logger.warn('favicon 主页抓取失败', {
      service: 'web-api',
      homepage: homepage.toString(),
      error: err instanceof Error ? err.message : err,
    });
  }
  return null;
}

app.get('/', async (c) => {
  const rawUrl = c.req.query('url');
  if (!rawUrl) {
    return c.json({ error: 'missing url' }, 400);
  }

  let homepage: URL;
  try {
    homepage = new URL(rawUrl);
  } catch {
    return c.json({ error: 'invalid url' }, 400);
  }
  if (homepage.protocol !== 'http:' && homepage.protocol !== 'https:') {
    return c.json({ error: 'unsupported protocol' }, 400);
  }

  const cacheKey = new Request(c.req.url);
  const cache = typeof caches !== 'undefined' ? await caches.open('favicon-cache') : undefined;
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const resp = await resolveFavicon(homepage);

  if (!resp) {
    logger.warn('favicon 抓取失败', { service: 'web-api', homepage: homepage.toString() });
    return c.json({ error: 'favicon not found' }, 404);
  }

  const headers = new Headers(resp.headers);
  headers.set('Cache-Control', `public, max-age=${CACHE_TTL}`);
  headers.set('Access-Control-Allow-Origin', '*');
  const out = new Response(resp.body, { status: 200, headers });

  if (cache && c.executionCtx) {
    c.executionCtx.waitUntil(cache.put(cacheKey, out.clone()));
  }
  return out;
});

export default app;
