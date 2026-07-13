import { describe, expect, it } from 'vitest';
import { isRssXml, parseV2exHotTopics } from './v2ex-adapter';

const HOT_HTML = `
<div class="box" id="TopicsHot">
  <div class="item_hot_topic_title"><a href="/t/123">Topic &amp; One</a></div>
  <div class="item_hot_topic_title"><a href="https://v2ex.com/t/456">Topic Two</a></div>
</div>
<div class="box" id="Other">
  <div class="item_hot_topic_title"><a href="/t/999">Should Be Ignored</a></div>
</div>
`;

describe('parseV2exHotTopics', () => {
  it('parses only items inside #TopicsHot and decodes html entities', async () => {
    const entries = await parseV2exHotTopics(HOT_HTML);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.id).toBe('v2ex-hot-123');
    expect(entries[0]?.title).toBe('Topic & One');
    expect(entries[0]?.link).toBe('https://v2ex.com/t/123');
    expect(entries[1]?.id).toBe('v2ex-hot-456');
    expect(entries[1]?.title).toBe('Topic Two');
    expect(entries[1]?.link).toBe('https://v2ex.com/t/456');
  });

  it('returns an empty list when #TopicsHot is missing', async () => {
    const entries = await parseV2exHotTopics('<div class="box" id="Other">x</div>');
    expect(entries).toEqual([]);
  });
});

describe('isRssXml', () => {
  it('detects rss/atom/xml declarations', () => {
    expect(isRssXml('<?xml version="1.0"?><rss version="2.0">')).toBe(true);
    expect(isRssXml('<rss>')).toBe(true);
    expect(isRssXml('<feed xmlns="http://www.w3.org/2005/Atom">')).toBe(true);
  });

  it('rejects ordinary html', () => {
    expect(isRssXml('<!DOCTYPE html><html><body>hi</body></html>')).toBe(false);
    expect(isRssXml('<div>just text</div>')).toBe(false);
    expect(isRssXml('')).toBe(false);
  });
});
