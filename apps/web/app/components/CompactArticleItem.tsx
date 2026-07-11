import { Text, Group, Tooltip, ActionIcon, Box, Loader } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconSparkles, IconX } from '@tabler/icons-react';
import type { Article } from '@repo/shared';
import { formatRelativeTime } from '@repo/shared';
import { useRef, useState, useEffect } from 'react';

interface CompactArticleItemProps {
  article: Article;
  read?: boolean;
  onRead?: (articleId: number) => void;
}

type SummaryState = 'collapsed' | 'loading' | 'open' | 'error';

export function CompactArticleItem({ article, read = false, onRead }: CompactArticleItemProps) {
  const displayTitle = article.translatedTitle ?? article.title;
  const titleRef = useRef<HTMLAnchorElement>(null);
  const [hovered, setHovered] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const [summaryState, setSummaryState] = useState<SummaryState>('collapsed');
  const [summaryText, setSummaryText] = useState(article.summary ?? '');
  const [errorMsg, setErrorMsg] = useState('');

  const isTouch = useMediaQuery('(hover: none)');
  const iconVisible = hovered || isTouch || summaryState === 'open' || summaryState === 'error';

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;

    const check = () => {
      setIsTruncated(el.scrollHeight > el.clientHeight);
    };

    check();

    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [displayTitle]);

  const handleClick = async () => {
    if (summaryState === 'loading') return;
    if (summaryState === 'open' || summaryState === 'error') {
      setSummaryState('collapsed');
      return;
    }
    if (article.summary) {
      setSummaryText(article.summary);
      setSummaryState('open');
      return;
    }

    setSummaryState('loading');
    setErrorMsg('');
    try {
      const resp = await fetch(`/api/articles/${article.id}/summary`);
      const data = (await resp.json()) as { summary?: string; error?: string };
      if (!resp.ok) {
        throw new Error(data?.error ?? '总结生成失败');
      }
      setSummaryText(data.summary ?? '');
      setSummaryState('open');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '总结生成失败');
      setSummaryState('error');
    }
  };

  const isExpanded = summaryState === 'open' || summaryState === 'error';
  const iconLabel = isExpanded ? '关闭总结' : '总结全文';

  return (
    <Box
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderBottom: '1px solid var(--mantine-color-gray-2)',
      }}
    >
      <Group
        justify="space-between"
        wrap="nowrap"
        py={6}
        px="xs"
        style={{ minHeight: 36 }}
      >
        <Tooltip label={displayTitle} disabled={!isTruncated} position="top" openDelay={600} withArrow>
          <Text
            ref={titleRef}
            component="a"
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            size="sm"
            lineClamp={1}
            className="article-link"
            data-article-id={article.id}
            onClick={() => onRead?.(article.id)}
            style={{
              flex: 1,
              minWidth: 0,
              color: read ? 'var(--mantine-color-gray-5)' : undefined,
            }}
          >
            {displayTitle}
          </Text>
        </Tooltip>
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0, marginLeft: 8 }}>
          <Tooltip
            label={summaryState === 'loading' ? '正在生成总结…' : iconLabel}
            openDelay={300}
            withArrow
          >
            <ActionIcon
              variant="subtle"
              color={isExpanded ? 'gray' : 'blue'}
              size="sm"
              onClick={handleClick}
              loading={summaryState === 'loading'}
              aria-label={iconLabel}
              style={{
                opacity: iconVisible ? 1 : 0,
                transition: 'opacity 120ms ease',
                pointerEvents: iconVisible ? 'auto' : 'none',
              }}
            >
              {isExpanded ? <IconX size={16} /> : <IconSparkles size={16} />}
            </ActionIcon>
          </Tooltip>
          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
            {formatRelativeTime(article.publishedAt)}
          </Text>
        </Group>
      </Group>

      {summaryState === 'open' && summaryText && (
        <Box
          px="xs"
          pb={8}
          pt={8}
          style={{
            fontSize: 13,
            lineHeight: 1.6,
            color: 'var(--mantine-color-gray-7)',
            background: 'var(--mantine-color-gray-0)',
            borderRadius: 4,
          }}
        >
          {summaryText}
        </Box>
      )}

      {summaryState === 'error' && (
        <Box
          px="xs"
          pb={8}
          style={{
            fontSize: 13,
            color: 'var(--mantine-color-red-6)',
            margin: '0 8px 6px',
          }}
        >
          总结失败：{errorMsg}
        </Box>
      )}

      {summaryState === 'loading' && (
        <Group gap={6} px="xs" pb={8} style={{ margin: '0 8px 6px' }}>
          <Loader size={12} />
          <Text size="xs" c="dimmed">正在生成总结…</Text>
        </Group>
      )}
    </Box>
  );
}
