import { Text, Group } from '@mantine/core';
import type { Article } from '@repo/shared';
import { formatRelativeTime } from '@repo/shared';

interface CompactArticleItemProps {
  article: Article;
}

export function CompactArticleItem({ article }: CompactArticleItemProps) {
  const displayTitle = article.translatedTitle ?? article.title;

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
      <Text
        component="a"
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        size="sm"
        lineClamp={1}
        style={{ flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}
      >
        {displayTitle}
      </Text>
      <Text size="xs" c="dimmed" style={{ flexShrink: 0, marginLeft: 8 }}>
        {formatRelativeTime(article.publishedAt)}
      </Text>
    </Group>
  );
}
