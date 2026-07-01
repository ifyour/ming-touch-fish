import { Card, Text, Badge, Group } from '@mantine/core';
import { IconExternalLink } from '@tabler/icons-react';
import type { Article } from '@repo/shared';
import { formatRelativeTime } from '@repo/shared';

interface ArticleCardProps {
  article: Article;
}

export function ArticleCard({ article }: ArticleCardProps) {
  const displayTitle = article.translatedTitle ?? article.title;
  const hasTranslation = Boolean(article.translatedTitle);

  return (
    <Card withBorder shadow="sm" radius="md" padding="md">
      <Card.Section inheritPadding py="xs">
        <Group justify="space-between" wrap="nowrap">
          <Text
            component="a"
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            fw={600}
            lineClamp={2}
            className="article-link"
          >
            {displayTitle}
          </Text>
          <IconExternalLink size={16} style={{ flexShrink: 0 }} />
        </Group>
      </Card.Section>

      {hasTranslation && (
        <Text size="sm" c="dimmed" mt="xs" lineClamp={1}>
          原文：{article.title}
        </Text>
      )}

      <Group mt="md" gap="xs">
        <Badge variant="light" size="sm">
          {formatRelativeTime(article.publishedAt)}
        </Badge>
      </Group>
    </Card>
  );
}
