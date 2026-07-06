const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v2';
const SCRAPE_TIMEOUT = 30000;

export interface FirecrawlScrapeResult {
  html: string;
  markdown: string;
  metadata: {
    title?: string;
    description?: string;
    sourceURL?: string;
    statusCode?: number;
  };
}

export async function scrapePage(url: string, apiKey: string): Promise<FirecrawlScrapeResult> {
  const response = await fetch(`${FIRECRAWL_BASE}/scrape`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      formats: ['html', 'markdown'],
      onlyMainContent: false,
      maxAge: 0,
    }),
    signal: AbortSignal.timeout(SCRAPE_TIMEOUT),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status === 402) {
      throw Object.assign(new Error(`Firecrawl credits exhausted (402)`), { code: 402 });
    }
    if (response.status === 401) {
      throw Object.assign(new Error(`Firecrawl invalid API key (401)`), { code: 401 });
    }
    throw new Error(`Firecrawl API error: ${response.status} ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    success: boolean;
    data: FirecrawlScrapeResult;
  };

  if (!data.success || !data.data) {
    throw new Error('Firecrawl scrape failed: no data returned');
  }

  return data.data;
}
