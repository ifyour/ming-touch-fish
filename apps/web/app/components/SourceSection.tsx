import { Stack, Title, Text, Card, ActionIcon, Tooltip, Anchor, Center } from '@mantine/core';
import type { ArticleGroupedBySource } from '@repo/shared';
import { CompactArticleItem } from './CompactArticleItem.js';
import { IconCheck } from '@tabler/icons-react';
import { useState, useRef, useEffect } from 'react';

interface SourceSectionProps {
  group: ArticleGroupedBySource;
}

const INITIAL_COUNT = 10;
const COOKIE_EXPIRY_SECONDS = 60 * 60 * 24 * 365;

function getReadArticleIds(): Set<number> {
  if (typeof document === 'undefined') return new Set();
  const match = document.cookie.match(/(?:^|; )read_articles=([^;]*)/);
  if (!match) return new Set();
  return new Set(match[1].split(',').map(Number).filter((n) => !isNaN(n)));
}

function saveReadArticleIds(ids: Set<number>) {
  const value = Array.from(ids).join(',');
  document.cookie = `read_articles=${value}; max-age=${COOKIE_EXPIRY_SECONDS}; path=/`;
}

export function SourceSection({ group }: SourceSectionProps) {
  const { source, articles } = group;
  const [expanded, setExpanded] = useState(false);
  const [readArticleIds, setReadArticleIds] = useState<Set<number>>(new Set());

  const hasMore = articles.length > INITIAL_COUNT;
  const displayArticles = expanded ? articles : articles.slice(0, INITIAL_COUNT);
  const allRead = displayArticles.length > 0 && displayArticles.every((a) => readArticleIds.has(a.id));
  const cardRef = useRef<HTMLDivElement>(null);
  const [lockedCardHeight, setLockedCardHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!expanded) setLockedCardHeight(null);
  }, [expanded]);

  useEffect(() => {
    setReadArticleIds(getReadArticleIds());
  }, []);

  const handleMarkRead = () => {
    const ids = new Set(readArticleIds);
    for (const article of displayArticles) {
      ids.add(article.id);
    }
    saveReadArticleIds(ids);
    setReadArticleIds(ids);
  };

  const handleShowMore = () => {
    if (cardRef.current) {
      setLockedCardHeight(cardRef.current.clientHeight);
    }
    setExpanded(true);
  };

  return (
    <Card ref={cardRef} withBorder radius="md" padding={0} style={lockedCardHeight ? { height: lockedCardHeight, display: 'flex', flexDirection: 'column' } : undefined} onMouseLeave={() => expanded && setExpanded(false)}>
      <Card.Section withBorder inheritPadding py="sm" px="md">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title order={5}>{source.name}</Title>
          <Tooltip label="标记已读" position="top" withArrow>
            <ActionIcon variant="subtle" color={allRead ? 'teal' : 'gray'} size="sm" onClick={handleMarkRead}>
              <IconCheck size={14} />
            </ActionIcon>
          </Tooltip>
        </div>
      </Card.Section>
      {articles.length === 0 ? (
        <Text c="dimmed" size="sm" py="sm" px="md">
          暂无最近资讯
        </Text>
      ) : (
        <Stack gap={0} style={expanded ? { flex: 1, overflowY: 'auto', minHeight: 0 } : undefined}>
          {displayArticles.map((article) => (
            <CompactArticleItem key={article.id} article={article} read={readArticleIds.has(article.id)} />
          ))}
        </Stack>
      )}
      {hasMore && !expanded && (
        <Card.Section withBorder style={{ borderTop: 'none', cursor: 'pointer'}} onClick={handleShowMore}>
          <Center py={4}>
            <Anchor component="button" size="xs" c="dimmed">
              Show more
            </Anchor>
          </Center>
        </Card.Section>
      )}
    </Card>
  );
}
