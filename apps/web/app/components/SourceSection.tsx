import { Stack, Title, Text, Card, ActionIcon, Tooltip, Anchor, Center } from '@mantine/core';
import type { ArticleGroupedBySource } from '@repo/shared';
import { CompactArticleItem } from './CompactArticleItem.js';
import { IconCheck } from '@tabler/icons-react';
import { useState, useRef, useEffect } from 'react';

interface SourceSectionProps {
  group: ArticleGroupedBySource;
}

const INITIAL_COUNT = 10;
const STORAGE_KEY = 'read_articles';
const MAX_READ_IDS = 5000;

function getReadArticleIds(): Set<number> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr: number[] = JSON.parse(raw);
    return new Set(arr.filter((n) => typeof n === 'number' && !isNaN(n)));
  } catch {
    return new Set();
  }
}

function saveReadArticleIds(ids: Set<number>) {
  if (typeof localStorage === 'undefined') return;
  try {
    const arr = Array.from(ids);
    if (arr.length > MAX_READ_IDS) {
      arr.splice(0, arr.length - MAX_READ_IDS);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch {
    // localStorage 不可用或已满，静默忽略
  }
}

export function SourceSection({ group }: SourceSectionProps) {
  const { source, articles } = group;
  const [expanded, setExpanded] = useState(false);
  const [readArticleIds, setReadArticleIds] = useState<Set<number>>(getReadArticleIds);

  const hasMore = articles.length > INITIAL_COUNT;
  const displayArticles = expanded ? articles : articles.slice(0, INITIAL_COUNT);
  const allRead = displayArticles.length > 0 && displayArticles.every((a) => readArticleIds.has(a.id));
  const cardRef = useRef<HTMLDivElement>(null);
  const [lockedCardHeight, setLockedCardHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!expanded) setLockedCardHeight(null);
  }, [expanded]);

  const handleReadArticle = (articleId: number) => {
    if (readArticleIds.has(articleId)) return;
    const ids = new Set(readArticleIds);
    ids.add(articleId);
    saveReadArticleIds(ids);
    setReadArticleIds(ids);
  };

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
            <CompactArticleItem key={article.id} article={article} read={readArticleIds.has(article.id)} onRead={handleReadArticle} />
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
