import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useSession } from '../lib/auth-client';

const STORAGE_KEY = 'read_articles';
const MAX_READ_IDS = 5000;

function getLocalReadIds(): Set<number> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr: number[] = JSON.parse(raw);
    return new Set(arr.filter((n) => typeof n === 'number' && !Number.isNaN(n)));
  } catch {
    return new Set();
  }
}

function saveLocalReadIds(ids: Set<number>) {
  if (typeof localStorage === 'undefined') return;
  try {
    const arr = Array.from(ids);
    if (arr.length > MAX_READ_IDS) arr.splice(0, arr.length - MAX_READ_IDS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch {
    // localStorage 不可用或已满，静默忽略
  }
}

export interface UseReadArticles {
  readIds: Set<number>;
  markRead: (articleId: number) => void;
  markAllRead: (articleIds: number[]) => void;
  isAuthenticated: boolean;
}

const ReadArticlesContext = createContext<UseReadArticles | null>(null);

// 已读状态集中在 Provider 中维护（首页只挂载一个），避免每个 SourceSection 各自请求
// /api/read/articles 造成大量重复请求。子组件通过 useReadArticles() 读取同一份状态。
export function ReadArticlesProvider({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  const isAuthenticated = !!session?.user;

  const [localIds, setLocalIds] = useState<Set<number>>(getLocalReadIds);
  const [remoteIds, setRemoteIds] = useState<Set<number>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const localIdsRef = useRef(localIds);
  localIdsRef.current = localIds;
  const fetchingRef = useRef(false);

  // 登录态变化：拉取 / 重置远程已读集合。fetchingRef 防止 effect 重跑时重复请求。
  useEffect(() => {
    if (isPending) return;
    if (!isAuthenticated) {
      setRemoteIds(new Set());
      setLoaded(false);
      return;
    }
    if (fetchingRef.current) return;
    let cancelled = false;
    fetchingRef.current = true;
    setLoaded(false);
    fetch('/api/read/articles')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        if (cancelled) return;
        const ids = (data as { articleIds?: number[] } | null)?.articleIds ?? [];
        setRemoteIds(new Set(ids));
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setRemoteIds(new Set());
          setLoaded(true);
        }
      })
      .finally(() => {
        fetchingRef.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isPending]);

  const markRead = useCallback(
    (articleId: number) => {
      if (isAuthenticated) {
        fetch('/api/read/articles', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ articleId }),
          credentials: 'include',
        }).catch(() => {});
        setRemoteIds((prev) => {
          if (prev.has(articleId)) return prev;
          const next = new Set(prev);
          next.add(articleId);
          return next;
        });
      } else {
        const prev = getLocalReadIds();
        if (prev.has(articleId)) return;
        const next = new Set(prev);
        next.add(articleId);
        saveLocalReadIds(next);
        setLocalIds(next);
      }
    },
    [isAuthenticated],
  );

  const readIds = isAuthenticated ? remoteIds : localIds;

  const markAllRead = useCallback(
    (articleIds: number[]) => {
      const targets = articleIds.filter((id) => !readIds.has(id));
      if (targets.length === 0) return;
      if (isAuthenticated) {
        fetch('/api/read/articles/batch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ articleIds: targets }),
          credentials: 'include',
        }).catch(() => {});
        setRemoteIds((prev) => {
          const next = new Set(prev);
          for (const id of targets) next.add(id);
          return next;
        });
      } else {
        const next = new Set(localIdsRef.current);
        for (const id of targets) next.add(id);
        saveLocalReadIds(next);
        setLocalIds(next);
      }
    },
    [isAuthenticated, readIds],
  );

  const value: UseReadArticles = {
    readIds,
    markRead,
    markAllRead,
    isAuthenticated: isAuthenticated && loaded,
  };
  return <ReadArticlesContext.Provider value={value}>{children}</ReadArticlesContext.Provider>;
}

// 读取已读状态。必须在 ReadArticlesProvider 内使用（首页已包裹）。
export function useReadArticles(): UseReadArticles {
  const ctx = useContext(ReadArticlesContext);
  if (!ctx) throw new Error('useReadArticles 必须在 ReadArticlesProvider 内使用');
  return ctx;
}
