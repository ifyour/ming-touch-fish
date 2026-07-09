import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { SimpleGrid, Alert, Container, Text, Loader, Center, Collapse, Anchor, Stack } from '@mantine/core';
import { IconAlertCircle, IconChevronDown } from '@tabler/icons-react';
import { useState } from 'react';
import type { ArticleGroupedBySource } from '@repo/shared';
import { isStaleGroup } from '@repo/shared';
import { SourceSection } from '../components/SourceSection.js';
import { getApiUrl } from '../utils/apiUrl.js';

export const Route = createFileRoute('/')({
  component: HomePage,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData({
      queryKey: ['articles', 'grouped'],
      queryFn: fetchGroupedArticles,
      staleTime: 5 * 60 * 1000,
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
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
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

  const activeGroups = (groups ?? []).filter((g) => !isStaleGroup(g));
  const staleGroups = (groups ?? []).filter((g) => isStaleGroup(g));
  const [showStale, setShowStale] = useState(false);

  return (
    <Container size="xl">
      {groups?.length === 0 ? (
        <Alert>暂无资讯，请先添加资讯源并运行抓取。</Alert>
      ) : (
        <>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md" verticalSpacing="md">
            {activeGroups.map((group) => <SourceSection key={group.source.id} group={group} />)}
          </SimpleGrid>
          {staleGroups.length > 0 && (
            <Stack gap="sm" mt="md">
              <Center>
                <Anchor component="button" size="sm" c="dimmed" onClick={() => setShowStale((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>{showStale ? '收起' : '加载更多'}</span>
                  <IconChevronDown size={14} style={{ transform: showStale ? 'rotate(180deg)' : undefined, transition: 'transform 150ms ease' }} />
                </Anchor>
              </Center>
              <Collapse in={showStale}>
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md" verticalSpacing="md">
                  {staleGroups.map((group) => <SourceSection key={group.source.id} group={group} />)}
                </SimpleGrid>
              </Collapse>
            </Stack>
          )}
        </>
      )}
    </Container>
  );
}
