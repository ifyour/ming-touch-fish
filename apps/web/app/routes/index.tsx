import { createFileRoute } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import { SimpleGrid, Title, Loader, Alert } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import type { ArticleGroupedBySource } from '@repo/shared';
import { SourceSection } from '../components/SourceSection.js';
import { getApiUrl } from '../utils/apiUrl.js';

export const Route = createFileRoute('/')({
  component: HomePage,
  loader: async ({ context }) => {
    const data = await context.queryClient.fetchQuery({
      queryKey: ['articles', 'grouped'],
      queryFn: fetchGroupedArticles,
      staleTime: 0,
    });
    return data;
  },
});

async function fetchGroupedArticles(): Promise<ArticleGroupedBySource[]> {
  const response = await fetch(await getApiUrl('/api/articles/grouped'), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Failed to load articles');
  }
  return response.json();
}

function HomePage() {
  const { data: groups, error, isLoading } = useSuspenseQuery({
    queryKey: ['articles', 'grouped'],
    queryFn: fetchGroupedArticles,
    staleTime: 0,
  });

  if (isLoading) {
    return <Loader />;
  }

  if (error) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} title="加载失败" color="red">
        {error.message}
      </Alert>
    );
  }

  return (
    <>
      <Title order={3} py="md">今日热点</Title>
      {groups?.length === 0 ? (
        <Alert>暂无资讯，请先添加资讯源并运行抓取。</Alert>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md" verticalSpacing="md">
          {groups?.map((group) => <SourceSection key={group.source.id} group={group} />)}
        </SimpleGrid>
      )}
    </>
  );
}
