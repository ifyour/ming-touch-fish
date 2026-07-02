import { Stack, Title, Text, Card, ActionIcon, Tooltip, Anchor, Center } from '@mantine/core';
import type { ArticleGroupedBySource, Article } from '@repo/shared';
import { CompactArticleItem } from './CompactArticleItem.js';
import { IconRefresh } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { getApiUrl } from '../utils/apiUrl.js';
import { useState, useRef, useEffect } from 'react';

interface SourceSectionProps {
  group: ArticleGroupedBySource;
}

const INITIAL_COUNT = 10;

export function SourceSection({ group }: SourceSectionProps) {
  const { source, articles } = group;
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [extraArticles, setExtraArticles] = useState<Article[]>([]);
  const [expanded, setExpanded] = useState(false);

  const allArticles = [...articles, ...extraArticles];
  const hasMore = allArticles.length > INITIAL_COUNT;
  const displayArticles = expanded ? allArticles : allArticles.slice(0, INITIAL_COUNT);
  const cardRef = useRef<HTMLDivElement>(null);
  const [lockedCardHeight, setLockedCardHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!expanded) setLockedCardHeight(null);
  }, [expanded]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch(await getApiUrl(`/api/sources/${source.id}/fetch`), { method: 'POST' });
      queryClient.invalidateQueries({ queryKey: ['articles', 'grouped'] });
      setExtraArticles([]);
      setExpanded(false);
    } catch {
      // ignore
    } finally {
      setRefreshing(false);
    }
  };

  const handleShowMore = async () => {
    if (cardRef.current) {
      setLockedCardHeight(cardRef.current.clientHeight);
    }
    setExpanded(true);
    if (allArticles.length < 20 && !loadingMore) {
      setLoadingMore(true);
      try {
        const res = await fetch(
          await getApiUrl(`/api/articles?sourceId=${source.id}&offset=${allArticles.length}&limit=10`)
        );
        if (res.ok) {
          const newArticles: Article[] = await res.json();
          if (newArticles.length > 0) {
            setExtraArticles((prev) => [...prev, ...newArticles]);
          }
        }
      } finally {
        setLoadingMore(false);
      }
    }
  };

  return (
    <Card ref={cardRef} withBorder radius="md" padding={0} style={lockedCardHeight ? { height: lockedCardHeight, display: 'flex', flexDirection: 'column' } : undefined} onMouseLeave={() => expanded && setExpanded(false)}>
      <Card.Section withBorder inheritPadding py="sm" px="md">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title order={5}>{source.name}</Title>
          <Tooltip label="刷新" position="top" withArrow>
            <ActionIcon variant="subtle" color="gray" size="sm" loading={refreshing} onClick={handleRefresh}>
              <IconRefresh size={14} />
            </ActionIcon>
          </Tooltip>
        </div>
      </Card.Section>
      {allArticles.length === 0 ? (
        <Text c="dimmed" size="sm" py="sm" px="md">
          暂无最近资讯
        </Text>
      ) : (
        <Stack gap={0} style={expanded ? { flex: 1, overflowY: 'auto', minHeight: 0 } : undefined}>
          {displayArticles.map((article) => (
            <CompactArticleItem key={article.id} article={article} />
          ))}
          {loadingMore && (
            <Text c="dimmed" size="xs" ta="center" py="sm">加载中...</Text>
          )}
        </Stack>
      )}
      {hasMore && !expanded && (
        <Card.Section withBorder style={{ borderTop: 'none' }}>
          <Center py={4}>
            <Anchor component="button" size="xs" c="dimmed" onClick={handleShowMore}>
              Show more
            </Anchor>
          </Center>
        </Card.Section>
      )}
    </Card>
  );
}
