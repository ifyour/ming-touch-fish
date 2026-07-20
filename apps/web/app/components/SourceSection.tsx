import {
  ActionIcon,
  Anchor,
  Card,
  Center,
  Loader,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { getSourceHomepage } from '@repo/shared';
import { IconCheck } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useReadArticles } from '../hooks/useReadArticles';
import type { ArticleGroupedBySource } from '../types/api';
import { CompactArticleItem } from './CompactArticleItem.js';

interface SourceSectionProps {
  group: ArticleGroupedBySource;
}

const INITIAL_COUNT = 10;
const PAGE_SIZE = 10;

function buildGroupedUrl(sourceId: number, offset: number) {
  const params = new URLSearchParams({
    sourceId: String(sourceId),
    offset: String(offset),
    limit: String(PAGE_SIZE),
  });
  return `/api/articles/grouped?${params.toString()}`;
}
export function SourceSection({ group }: SourceSectionProps) {
  const { source, articles: initialArticles, total } = group;
  const [articles, setArticles] = useState(initialArticles.slice(0, INITIAL_COUNT));
  const [offset, setOffset] = useState(articles.length);
  const [hasMore, setHasMore] = useState(articles.length < total);
  const [loading, setLoading] = useState(false);
  const { readIds: readArticleIds, markRead: handleReadArticle, markAllRead } = useReadArticles();
  // expanded 控制卡片是否锁定高度并允许滚动；点 Show More 或滚动到底部时展开。
  const [expanded, setExpanded] = useState(false);

  const allRead = articles.length > 0 && articles.every((a) => readArticleIds.has(a.id));
  // 折叠态只展示前 INITIAL_COUNT 条，保证卡片高度始终固定；展开态才在滚动区内显示已加载的全部文章。
  const displayArticles = expanded ? articles : articles.slice(0, INITIAL_COUNT);
  const cardRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const scrollBodyRef = useRef<HTMLDivElement>(null);
  const [lockedCardHeight, setLockedCardHeight] = useState<number | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (!expanded) setLockedCardHeight(null);
  }, [expanded]);

  useEffect(() => {
    const header = headerRef.current;
    if (typeof IntersectionObserver === 'undefined' || !header) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) setExpanded(false);
      },
      { threshold: 0 },
    );
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  const expandCard = useCallback(() => {
    if (cardRef.current) {
      setLockedCardHeight(cardRef.current.clientHeight);
    }
    setExpanded(true);
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const resp = await fetch(buildGroupedUrl(source.id, offset));
      if (!resp.ok) return;
      const data = (await resp.json()) as ArticleGroupedBySource[];
      const next = data[0]?.articles ?? [];
      const more = resp.headers.get('X-Has-More') === 'true';
      setArticles((prev) => {
        const seen = new Set(prev.map((a) => a.id));
        return [...prev, ...next.filter((a) => !seen.has(a.id))];
      });
      setOffset((o) => o + next.length);
      setHasMore(more && next.length > 0);
    } catch {
      // 加载失败忽略，保留现有内容
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [hasMore, offset, source.id]);

  // 滚动容器内滚到底部时触发加载（替代零高度 sentinel 的 IntersectionObserver，更可靠）。
  const handleScroll = useCallback(() => {
    const el = scrollBodyRef.current;
    if (!el || !hasMore || loadingRef.current) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      void loadMore();
    }
  }, [hasMore, loadMore]);

  const handleMarkRead = () => {
    markAllRead(articles.map((a) => a.id));
  };

  const handleShowMore = () => {
    expandCard();
    void loadMore();
  };

  const faviconSrc = `/api/favicon?url=${encodeURIComponent(getSourceHomepage(source.url))}`;

  const showMoreVisible = hasMore && !expanded;

  return (
    <Card
      ref={cardRef}
      withBorder
      radius="md"
      padding={0}
      style={
        lockedCardHeight
          ? { height: lockedCardHeight, display: 'flex', flexDirection: 'column' }
          : undefined
      }
      onMouseLeave={() => setExpanded(false)}
    >
      <Card.Section ref={headerRef} withBorder inheritPadding py="sm" px="md">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title order={5} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <img
              src={faviconSrc}
              width={16}
              height={16}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              style={{ borderRadius: 3, objectFit: 'contain', flexShrink: 0 }}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
            <Anchor
              href={getSourceHomepage(source.url)}
              target="_blank"
              rel="noopener noreferrer"
              underline="never"
              c="inherit"
            >
              {source.name}
            </Anchor>
          </Title>
          <Tooltip label="标记已读" position="top" withArrow>
            <ActionIcon
              variant="subtle"
              color={allRead ? 'teal' : 'gray'}
              size="sm"
              onClick={handleMarkRead}
            >
              <IconCheck size={14} />
            </ActionIcon>
          </Tooltip>
        </div>
      </Card.Section>
      {initialArticles.length === 0 ? (
        <Text c="dimmed" size="sm" py="sm" px="md">
          暂无最近资讯
        </Text>
      ) : (
        <Stack
          ref={scrollBodyRef}
          gap={0}
          onScroll={handleScroll}
          style={expanded ? { flex: 1, overflowY: 'auto', minHeight: 0 } : undefined}
        >
          {displayArticles.map((article) => (
            <CompactArticleItem
              key={article.id}
              article={article}
              read={readArticleIds.has(article.id)}
              onRead={handleReadArticle}
            />
          ))}
          {expanded && loading && (
            <Center py={6}>
              <Loader size={14} />
            </Center>
          )}
        </Stack>
      )}
      {showMoreVisible && (
        <Card.Section
          withBorder
          style={{ borderTop: 'none', cursor: 'pointer' }}
          onClick={handleShowMore}
        >
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
