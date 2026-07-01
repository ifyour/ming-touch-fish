import { Stack, Title, Text, Card, ActionIcon, Tooltip } from '@mantine/core';
import type { ArticleGroupedBySource } from '@repo/shared';
import { CompactArticleItem } from './CompactArticleItem.js';
import { IconRefresh } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { getApiUrl } from '../utils/apiUrl.js';
import { useState } from 'react';

interface SourceSectionProps {
  group: ArticleGroupedBySource;
}

export function SourceSection({ group }: SourceSectionProps) {
  const { source, articles } = group;
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch(await getApiUrl(`/api/sources/${source.id}/fetch`), { method: 'POST' });
      queryClient.invalidateQueries({ queryKey: ['articles', 'grouped'] });
    } catch {
      // ignore
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Card withBorder radius="md" padding={0}>
      <Card.Section withBorder inheritPadding py="sm" px="md">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title order={5}>{source.name}</Title>
          <Tooltip label="刷新" position="top" withArrow>
            <ActionIcon variant="subtle" color="gray" loading={refreshing} onClick={handleRefresh}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </div>
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
