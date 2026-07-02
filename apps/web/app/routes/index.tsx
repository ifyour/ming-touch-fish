import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { SimpleGrid, Alert, Container, Text, Loader, Center } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import type { ArticleGroupedBySource } from '@repo/shared';
import { SourceSection } from '../components/SourceSection.js';
import { getApiUrl } from '../utils/apiUrl.js';

export const Route = createFileRoute('/')({
  component: HomePage,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData({
      queryKey: ['articles', 'grouped'],
      queryFn: fetchGroupedArticles,
      staleTime: 30_000,
    });
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
  const { data: groups, error, isLoading } = useQuery({
    queryKey: ['articles', 'grouped'],
    queryFn: fetchGroupedArticles,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  if (isLoading) {
    return (
      <Container size="xl">
        <Center h={300}>
          <Loader />
        </Center>
      </Container>
    );
  }

  if (error) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} title="加载失败" color="red">
        {error.message}
      </Alert>
    );
  }

  return (
    <Container size="xl">
      {groups?.length === 0 ? (
        <Alert>暂无资讯，请先添加资讯源并运行抓取。</Alert>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md" verticalSpacing="md">
          {groups?.map((group) => <SourceSection key={group.source.id} group={group} />)}
        </SimpleGrid>
      )}
    </Container>
  );
}
