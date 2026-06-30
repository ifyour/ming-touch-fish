import { Stack, Title, Text, SimpleGrid } from '@mantine/core';
import type { ArticleGroupedBySource } from '@repo/shared';
import { ArticleCard } from './ArticleCard.js';

interface SourceSectionProps {
  group: ArticleGroupedBySource;
}

export function SourceSection({ group }: SourceSectionProps) {
  const { source, articles } = group;

  return (
    <Stack gap="sm">
      <Title order={4}>{source.name}</Title>
      {articles.length === 0 ? (
        <Text c="dimmed" size="sm">
          暂无最近资讯
        </Text>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {articles.map((article) => (
            <ArticleCard key={article.id} article={article} />
          ))}
        </SimpleGrid>
      )}
    </Stack>
  );
}
