import { Stack, Title, Text, Card } from '@mantine/core';
import type { ArticleGroupedBySource } from '@repo/shared';
import { CompactArticleItem } from './CompactArticleItem.js';

interface SourceSectionProps {
  group: ArticleGroupedBySource;
}

export function SourceSection({ group }: SourceSectionProps) {
  const { source, articles } = group;

  return (
    <Card withBorder radius="md" padding={0}>
      <Card.Section withBorder inheritPadding py="sm" px="md">
        <Title order={5}>{source.name}</Title>
      </Card.Section>
      {articles.length === 0 ? (
        <Text c="dimmed" size="sm" py="sm" px="md">
          暂无最近资讯
        </Text>
      ) : (
        <Stack gap={0}>
          {articles.map((article) => (
            <CompactArticleItem key={article.id} article={article} />
          ))}
        </Stack>
      )}
    </Card>
  );
}
