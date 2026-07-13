import { describe, expect, it } from 'vitest';
import { extractFromHtml } from './extract';

describe('extractFromHtml', () => {
  it('extracts main text content via Readability', () => {
    const html =
      '<html><body><article><p>Hello world this is the article body</p></article></body></html>';
    const text = extractFromHtml(html);
    expect(text).toContain('Hello world this is the article body');
  });

  it('falls back to stripping tags for fragment html', () => {
    const text = extractFromHtml('<p>plain text content here</p>');
    expect(text).toBe('plain text content here');
  });

  it('returns plain text unchanged when there are no tags', () => {
    expect(extractFromHtml('Hello world plain')).toBe('Hello world plain');
  });

  it('throws when no content can be extracted and strip fallback is disabled', () => {
    expect(() => extractFromHtml('   ', { allowStripFallback: false })).toThrow();
  });
});
