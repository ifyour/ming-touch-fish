import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { SimpleGrid, Skeleton, Alert, Container, Stack, Group, Text } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import type { ArticleGroupedBySource } from '@repo/shared';
import { SourceSection } from '../components/SourceSection.js';
import { getApiUrl } from '../utils/apiUrl.js';

export const Route = createFileRoute('/')({
  component: HomePage,
});

async function fetchGroupedArticles(): Promise<ArticleGroupedBySource[]> {
  const response = await fetch(await getApiUrl('/api/articles/grouped'), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Failed to load articles');
  }
  return response.json();
}

function SkeletonCard() {
  return (
    <Stack>
      <Group gap="xs" px="md" py="sm">
        <Skeleton height={22} width="60%" />
        <Skeleton height={22} width={22} circle style={{ marginLeft: 'auto' }} />
      </Group>
      {Array.from({ length: 5 }).map((_, i) => (
        <Group key={i} px="xs" py={6} justify="space-between" wrap="nowrap">
          <Skeleton height={16} width={`${60 + Math.random() * 30}%`} />
          <Skeleton height={12} width={40} />
        </Group>
      ))}
    </Stack>
  );
}

function HomePage() {
  const { data: groups, error, isLoading } = useQuery({
    queryKey: ['articles', 'grouped'],
    queryFn: fetchGroupedArticles,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  if (isLoading) {
    return (
      <Container size="xl">
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md" verticalSpacing="md">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} radius="md" style={{ overflow: 'hidden' }}>
              <SkeletonCard />
            </Skeleton>
          ))}
        </SimpleGrid>
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
