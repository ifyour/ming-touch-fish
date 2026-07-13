import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translateTitles } from './translator';

function makeEnv(apiKey: string) {
  return { DEEPL_API_KEY: apiKey } as unknown as import('./types').Env;
}

function mockDeepL(translations: string[]) {
  const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? '{}');
    const texts: string[] = body.text ?? [];
    const mapped = texts.map((_t, i) => ({ text: translations[i] ?? null }));
    return new Response(JSON.stringify({ translations: mapped }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('translateTitles', () => {
  it('returns empty array for empty input without calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await translateTitles(makeEnv('KEY'), []);
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('splits titles into batches of at most 50', async () => {
    const fetchMock = mockDeepL(new Array(60).fill('t'));
    const titles = new Array(60).fill('Title');
    const result = await translateTitles(makeEnv('KEY'), titles);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(60);
    expect(result.every((r) => r === 't')).toBe(true);
  });

  it('routes to the free endpoint for :fx keys', async () => {
    const fetchMock = mockDeepL(['x']);
    await translateTitles(makeEnv('KEY:fx'), ['A']);
    expect(fetchMock.mock.calls[0][0]).toContain('api-free.deepl.com/v2/translate');
  });

  it('routes to the paid endpoint for normal keys', async () => {
    const fetchMock = mockDeepL(['x']);
    await translateTitles(makeEnv('KEY'), ['A']);
    expect(fetchMock.mock.calls[0][0]).toContain('api.deepl.com/v2/translate');
  });

  it('returns null entries when the API responds with an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('err', { status: 429 })),
    );
    const result = await translateTitles(makeEnv('KEY'), ['A']);
    expect(result).toEqual([null]);
  });
});
