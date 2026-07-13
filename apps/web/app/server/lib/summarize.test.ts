import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InsufficientContentError, isContentSufficient, summarizeArticle } from './summarize';

describe('isContentSufficient', () => {
  it('rejects empty or very short text', () => {
    expect(isContentSufficient('')).toBe(false);
    expect(isContentSufficient('short')).toBe(false);
    expect(isContentSufficient('x'.repeat(79))).toBe(false);
  });

  it('accepts 80 characters of real text', () => {
    expect(isContentSufficient('a'.repeat(80))).toBe(true);
  });

  it('rejects text that is almost all punctuation', () => {
    expect(isContentSufficient('.'.repeat(80))).toBe(false);
  });

  it('accepts text whose meaningful-char ratio exceeds the 0.3 threshold', () => {
    const text = 'a'.repeat(30) + ' '.repeat(49) + 'a';
    expect(text.length).toBe(80);
    expect(isContentSufficient(text)).toBe(true);
  });

  it('rejects text whose meaningful-char ratio is below 0.3', () => {
    const text = 'a'.repeat(20) + ' '.repeat(59) + 'a';
    expect(isContentSufficient(text)).toBe(false);
  });
});

describe('summarizeArticle', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws InsufficientContentError for insufficient text without calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(summarizeArticle('too short', 'KEY')).rejects.toBeInstanceOf(
      InsufficientContentError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls Gemini and returns the summary text', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: ' 摘要内容 ' }] } }] }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const summary = await summarizeArticle('a'.repeat(200), 'KEY');
    expect(summary).toBe('摘要内容');
    expect(fetchMock.mock.calls[0][0]).toContain('generativelanguage.googleapis.com');
    expect(fetchMock.mock.calls[0][0]).toContain('KEY');
  });
});
