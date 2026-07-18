import {
  Alert,
  Anchor,
  Center,
  Collapse,
  Container,
  Loader,
  SimpleGrid,
  Stack,
} from '@mantine/core';
import { IconAlertCircle, IconChevronDown } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { SourceSection } from '../components/SourceSection.js';
import type { ArticleGroupedBySource } from '../types/api';
import { getApiUrl } from '../utils/apiUrl.js';
import { getGroupedBust } from '../utils/groupedBust.js';

export const Route = createFileRoute('/')({
  component: HomePage,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData({
      queryKey: ['articles', 'grouped', 'active'],
      queryFn: () => fetchGroupedArticles('active'),
      staleTime: 5 * 60 * 1000,
    });
  },
});

interface GroupedResult {
  groups: ArticleGroupedBySource[];
  hasStale: boolean;
}

async function fetchGroupedArticles(scope: 'active' | 'stale'): Promise<GroupedResult> {
  // 后台操作后前端会 bump groupedBust，携带该 token 使 URL 不同、穿透边缘长缓存立即拿到最新数据；
  // 普通刷新浏览（token 为 0）不附加，继续命中边缘缓存以降低 D1 读压力。
  const bust = getGroupedBust();
  const url = `/api/articles/grouped?scope=${scope}${bust ? `&bust=${bust}` : ''}`;
  const response = await fetch(await getApiUrl(url));
  if (!response.ok) {
    throw new Error('Failed to load articles');
  }
  const groups: ArticleGroupedBySource[] = await response.json();
  const hasStale = response.headers.get('X-Has-Stale') === 'true';
  return { groups, hasStale };
}

function HomePage() {
  const {
    data: active,
    error,
    isLoading,
  } = useQuery({
    queryKey: ['articles', 'grouped', 'active'],
    queryFn: () => fetchGroupedArticles('active'),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  });

  const [staleGroups, setStaleGroups] = useState<ArticleGroupedBySource[] | null>(null);
  const [loadingStale, setLoadingStale] = useState(false);
  const [showStale, setShowStale] = useState(false);

  // 过期源（更新慢的订阅源）按需懒加载：首次点击「加载更多」才查询，降低首页 D1 读压力。
  const loadStale = async () => {
    if (staleGroups) {
      setShowStale((v) => !v);
      return;
    }
    setLoadingStale(true);
    try {
      const data = await fetchGroupedArticles('stale');
      setStaleGroups(data.groups);
      setShowStale(true);
    } catch (e) {
      // 懒加载失败不影响活跃源展示
      console.error(e);
    } finally {
      setLoadingStale(false);
    }
  };

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

  const activeGroups = active?.groups ?? [];

  return (
    <Container size="xl">
      {activeGroups.length === 0 && !active?.hasStale && !staleGroups?.length ? (
        <Alert>暂无资讯，请先添加资讯源并运行抓取。</Alert>
      ) : (
        <>
          <SimpleGrid
            cols={{ base: 1, sm: 2, lg: 3 }}
            spacing="md"
            verticalSpacing="md"
            style={{ alignItems: 'start' }}
          >
            {activeGroups.map((group) => (
              <SourceSection key={group.source.id} group={group} />
            ))}
          </SimpleGrid>
          {showStale && staleGroups && (
            <Stack gap="sm" mt="md">
              <Collapse in={showStale}>
                <SimpleGrid
                  cols={{ base: 1, sm: 2, lg: 3 }}
                  spacing="md"
                  verticalSpacing="md"
                  style={{ alignItems: 'start' }}
                >
                  {staleGroups.map((group) => (
                    <SourceSection key={group.source.id} group={group} />
                  ))}
                </SimpleGrid>
              </Collapse>
            </Stack>
          )}
          {(active?.hasStale || staleGroups) && (
            <Center mt="md">
              <Anchor
                component="button"
                size="sm"
                c="dimmed"
                disabled={loadingStale}
                onClick={loadStale}
                style={{ display: 'flex', alignItems: 'center', gap: 4 }}
              >
                {loadingStale ? (
                  <>
                    <span>加载中…</span>
                    <Loader size={12} />
                  </>
                ) : (
                  <>
                    <span>{showStale ? '收起' : '加载更多'}</span>
                    <IconChevronDown
                      size={14}
                      style={{
                        transform: showStale ? 'rotate(180deg)' : undefined,
                        transition: 'transform 150ms ease',
                      }}
                    />
                  </>
                )}
              </Anchor>
            </Center>
          )}
        </>
      )}
    </Container>
  );
}
