import { Text, Group, Tooltip } from '@mantine/core';
import type { Article } from '@repo/shared';
import { formatRelativeTime } from '@repo/shared';
import { useRef, useState, useEffect } from 'react';

interface CompactArticleItemProps {
  article: Article;
}

export function CompactArticleItem({ article }: CompactArticleItemProps) {
  const displayTitle = article.translatedTitle ?? article.title;
  const titleRef = useRef<HTMLAnchorElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;

    const check = () => {
      setIsTruncated(el.scrollHeight > el.clientHeight);
    };

    check();

    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [displayTitle]);

  return (
    <Group
      justify="space-between"
      wrap="nowrap"
      py={6}
      px="xs"
      style={{
        borderBottom: '1px solid var(--mantine-color-gray-2)',
      }}
    >
      <Tooltip label={displayTitle} disabled={!isTruncated} position="top" openDelay={200} withArrow>
        <Text
          ref={titleRef}
          component="a"
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          size="sm"
          lineClamp={1}
          className="article-link"
          style={{ flex: 1, minWidth: 0 }}
        >
          {displayTitle}
        </Text>
      </Tooltip>
      <Text size="xs" c="dimmed" style={{ flexShrink: 0, marginLeft: 8 }}>
        {formatRelativeTime(article.publishedAt)}
      </Text>
    </Group>
  );
}
