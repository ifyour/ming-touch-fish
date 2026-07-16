import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  LoadingOverlay,
  Modal,
  NavLink,
  ScrollArea,
  Stack,
  Switch,
  Table,
  Text,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import type { Source, SourceInput } from '@repo/shared';
import { formatRelativeTime } from '@repo/shared';
import {
  IconEdit,
  IconGripVertical,
  IconPlus,
  IconRefresh,
  IconRss,
  IconTrash,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { SourceForm } from '../components/SourceForm.js';
import type { SourceWithLastFetchCount } from '../types/api';
import { getApiUrl } from '../utils/apiUrl.js';

function usePollingAfterFetch(
  queryClient: ReturnType<typeof useQueryClient>,
  _sources: SourceWithLastFetchCount[] | undefined,
  onSourceComplete: (id: number, newLastFetchedAt: Date) => void,
) {
  const [polling, setPolling] = useState(false);
  const snapshotRef = useRef<Map<number, string>>(new Map());

  const toKey = (v: Date | string | null | undefined) =>
    v instanceof Date ? v.toISOString() : (v ?? '');

  const startPolling = useCallback(
    (sourceIds?: number[]) => {
      // Fetch fresh data from query cache to avoid stale closure
      const currentSources = queryClient.getQueryData<SourceWithLastFetchCount[]>(['sources']);
      if (!currentSources) return;
      const snapshot = new Map<number, string>();
      const targets = sourceIds ?? currentSources.map((s) => s.id);
      for (const s of currentSources) {
        if (targets.includes(s.id)) {
          snapshot.set(s.id, toKey(s.lastFetchedAt));
        }
      }
      snapshotRef.current = snapshot;
      setPolling(true);
    },
    [queryClient],
  );

  useEffect(() => {
    if (!polling) return;
    let attempts = 0;
    const maxAttempts = 30;

    const interval = setInterval(async () => {
      attempts++;
      // 主动 refetch 获取最新数据
      const freshSources = await queryClient
        .refetchQueries({
          queryKey: ['sources'],
          type: 'active',
        })
        .then(() => queryClient.getQueryData<SourceWithLastFetchCount[]>(['sources']));

      if (!freshSources) return;

      for (const s of freshSources) {
        const prev = snapshotRef.current.get(s.id);
        if (prev !== undefined && toKey(s.lastFetchedAt) !== prev) {
          snapshotRef.current.delete(s.id);
          const ts = s.lastFetchedAt;
          onSourceComplete(s.id, ts instanceof Date ? ts : ts ? new Date(ts) : new Date());
        }
      }
      if (snapshotRef.current.size === 0 || attempts >= maxAttempts) {
        clearInterval(interval);
        setPolling(false);
        queryClient.invalidateQueries({ queryKey: ['articles', 'grouped'] });
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [polling, queryClient, onSourceComplete]);

  return { startPolling };
}

const adminTabs = [{ value: 'sources', label: '资讯源管理', icon: IconRss }] as const;

const adminTabSchema = z.enum(['sources']).default('sources');

export const Route = createFileRoute('/fish')({
  component: AdminPage,
  validateSearch: z.object({ tab: adminTabSchema }),
  loaderDeps: ({ search: { tab } }) => ({ tab }),
  loader: async ({ context, deps }) => {
    if (deps.tab === 'sources') {
      return context.queryClient.ensureQueryData({
        queryKey: ['sources'],
        queryFn: fetchSources,
      });
    }
  },
});

async function fetchSources(): Promise<SourceWithLastFetchCount[]> {
  const response = await fetch(await getApiUrl('/api/sources'));
  if (!response.ok) throw new Error('Failed to load sources');
  return response.json();
}

interface SortableRowProps {
  source: SourceWithLastFetchCount;
  isFetching: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onFetch: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleActive: () => void;
}

function SortableRow({
  source,
  isFetching,
  isSelected,
  onToggleSelect,
  onFetch,
  onEdit,
  onDelete,
  onToggleActive,
}: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: source.id,
  });

  const style = {
    transform: isDragging ? CSS.Transform.toString(transform) : undefined,
    transition: isDragging ? transition : undefined,
    opacity: isDragging ? 0.4 : undefined,
    zIndex: isDragging ? 1 : undefined,
  };

  return (
    <Table.Tr
      ref={setNodeRef}
      style={style}
      bg={isSelected ? 'var(--mantine-color-blue-0)' : undefined}
    >
      <Table.Td w={36}>
        <Checkbox
          aria-label={`选择 ${source.name}`}
          checked={isSelected}
          onChange={onToggleSelect}
        />
      </Table.Td>
      <Table.Td>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          style={{ cursor: 'grab' }}
          {...attributes}
          {...listeners}
        >
          <IconGripVertical size={14} />
        </ActionIcon>
      </Table.Td>
      <Table.Td>
        <Text size="xs" c="dimmed" ff="monospace">
          {source.id}
        </Text>
      </Table.Td>
      <Table.Td>{source.name}</Table.Td>
      <Table.Td>
        <Text size="sm" lineClamp={1} style={{ maxWidth: 240 }}>
          {source.url}
        </Text>
      </Table.Td>
      <Table.Td>
        <Badge variant="light">
          {(
            {
              hourly: '每小时',
              twice_daily: '每 12 小时',
              daily: '每天',
            } as Record<string, string>
          )[source.fetchFrequency] ?? source.fetchFrequency}
        </Badge>
      </Table.Td>
      <Table.Td>
        <Switch size="xs" checked={source.isActive} onChange={onToggleActive} />
      </Table.Td>
      <Table.Td>
        <Text size="xs" c="dimmed">
          {source.lastFetchedAt
            ? `${formatRelativeTime(source.lastFetchedAt)}更新了 ${source.lastFetchCount} 条`
            : '从未'}
        </Text>
      </Table.Td>
      <Table.Td>
        <Group gap={4}>
          <Button
            size="compact-xs"
            variant="light"
            disabled={isFetching}
            leftSection={
              <IconRefresh
                size={14}
                style={isFetching ? { animation: 'spin 1s linear infinite' } : undefined}
              />
            }
            onClick={onFetch}
          >
            更新
          </Button>
          <Button
            size="compact-xs"
            variant="default"
            leftSection={<IconEdit size={14} />}
            onClick={onEdit}
          >
            编辑
          </Button>
          <Button
            size="compact-xs"
            color="red"
            variant="light"
            leftSection={<IconTrash size={14} />}
            onClick={onDelete}
          >
            删除
          </Button>
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}

function AdminPage() {
  const { tab } = useSearch({ from: '/fish' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [opened, { open, close }] = useDisclosure(false);
  const [editingSource, setEditingSource] = useState<Source | undefined>(undefined);
  const [deletingSource, setDeletingSource] = useState<Source | undefined>(undefined);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deletingBatch, setDeletingBatch] = useState(false);
  const [fetchingIds, setFetchingIds] = useState<Set<number>>(new Set());

  const { data: sources, isLoading } = useQuery({
    queryKey: ['sources'],
    queryFn: fetchSources,
    staleTime: 5 * 60 * 1000,
  });

  const removeFetchingId = useCallback((id: number, newLastFetchedAt: Date) => {
    setFetchingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setSortedSources((prev) =>
      prev.map((s) => (s.id === id ? { ...s, lastFetchedAt: newLastFetchedAt } : s)),
    );
  }, []);

  const { startPolling } = usePollingAfterFetch(queryClient, sources, removeFetchingId);

  const [sortedSources, setSortedSources] = useState<SourceWithLastFetchCount[]>(
    () => sources ?? [],
  );

  const prevSources = useRef<SourceWithLastFetchCount[] | undefined>(undefined);
  useEffect(() => {
    if (sources && sources !== prevSources.current) {
      setSortedSources(sources);
      prevSources.current = sources;
    }
  }, [sources]);

  const createMutation = useMutation({
    mutationFn: async (values: SourceInput): Promise<Source> => {
      const res = await fetch(await getApiUrl('/api/sources'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: 'Request failed' }))) as {
          error?: string;
        };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<Source>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
      closeForm();
      notifications.show({
        title: '成功',
        message: '资讯源已添加',
        color: 'green',
      });
      fetchMutation.mutate(data.id);
    },
    onError: (err: Error) => {
      notifications.show({ title: '失败', message: err.message, color: 'red' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: number; values: SourceInput }) => {
      const res = await fetch(await getApiUrl(`/api/sources/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: 'Request failed' }))) as {
          error?: string;
        };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
      closeForm();
      notifications.show({
        title: '成功',
        message: '资讯源已更新',
        color: 'green',
      });
    },
    onError: (err: Error) => {
      notifications.show({ title: '失败', message: err.message, color: 'red' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(await getApiUrl(`/api/sources/${id}`), {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: 'Request failed' }))) as {
          error?: string;
        };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
      notifications.show({
        title: '成功',
        message: '资讯源已删除',
        color: 'green',
      });
    },
    onError: (err: Error) => {
      notifications.show({ title: '失败', message: err.message, color: 'red' });
    },
  });

  const updatePriorityBatch = useMutation({
    mutationFn: async (updates: Array<{ id: number; priority: number }>) => {
      const apiUrl = await getApiUrl('/api/sources/');
      await Promise.all(
        updates.map(async ({ id, priority }) => {
          const res = await fetch(`${apiUrl}${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ priority }),
          });
          if (!res.ok) throw new Error('Failed to update priority');
        }),
      );
    },
    onError: (err: Error) => {
      setSortedSources(prevSources.current ?? []);
      notifications.show({
        title: '排序失败',
        message: err.message,
        color: 'red',
      });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const body: { isActive: boolean; priority?: number } = { isActive };
      if (isActive && sources) {
        const minPriority = sources.reduce((min, s) => Math.min(min, s.priority), Infinity);
        body.priority = minPriority - 1;
      }
      const res = await fetch(await getApiUrl(`/api/sources/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to toggle status');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
    onError: (err: Error) => {
      notifications.show({ title: '失败', message: err.message, color: 'red' });
    },
  });

  const batchToggleActiveMutation = useMutation({
    mutationFn: async ({ ids, isActive }: { ids: number[]; isActive: boolean }) => {
      const apiUrl = await getApiUrl('/api/sources/');
      let nextPriority = sources
        ? sources.reduce((min, s) => Math.min(min, s.priority), Infinity) - 1
        : 0;
      await Promise.all(
        ids.map(async (id) => {
          const body: { isActive: boolean; priority?: number } = { isActive };
          if (isActive) {
            body.priority = nextPriority--;
          }
          const res = await fetch(`${apiUrl}${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) throw new Error('Failed to update status');
        }),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
      notifications.show({
        title: '成功',
        message: '已批量更新启用状态',
        color: 'green',
      });
      setSelectedIds(new Set());
    },
    onError: (err: Error) => {
      notifications.show({ title: '失败', message: err.message, color: 'red' });
    },
  });

  const batchDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const apiUrl = await getApiUrl('/api/sources/');
      await Promise.all(
        ids.map(async (id) => {
          const res = await fetch(`${apiUrl}${id}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('Failed to delete source');
        }),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
      queryClient.invalidateQueries({ queryKey: ['articles', 'grouped'] });
      notifications.show({
        title: '成功',
        message: '已批量删除选中资讯源',
        color: 'green',
      });
      setSelectedIds(new Set());
      setDeletingBatch(false);
    },
    onError: (err: Error) => {
      notifications.show({ title: '失败', message: err.message, color: 'red' });
    },
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !sortedSources.length) return;

      const oldIndex = sortedSources.findIndex((s) => s.id === active.id);
      const newIndex = sortedSources.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(sortedSources, oldIndex, newIndex);
      const updates = reordered.map((s, i) => ({
        id: s.id,
        priority: reordered.length - i,
      }));

      setSortedSources(reordered);
      updatePriorityBatch.mutate(updates);
    },
    [sortedSources, updatePriorityBatch],
  );

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected = sortedSources.length > 0 && sortedSources.every((s) => selectedIds.has(s.id));
  const someSelected = selectedIds.size > 0 && !allSelected;
  const selectedCount = selectedIds.size;

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedSources.map((s) => s.id)));
    }
  }, [allSelected, sortedSources]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const fetchMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(await getApiUrl(`/api/sources/${id}/fetch`), {
        method: 'POST',
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: 'Request failed' }))) as {
          error?: string;
        };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<{ success: boolean; queued: boolean }>;
    },
    onMutate: (id) => {
      setFetchingIds((prev) => new Set(prev).add(id));
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
      startPolling([variables]);
    },
    onError: (err: Error, id) => {
      setFetchingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      notifications.show({ title: '失败', message: err.message, color: 'red' });
    },
  });

  const fetchAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(await getApiUrl('/api/sources/fetch-all'), {
        method: 'POST',
      });
      if (!res.ok) throw new Error('一键刷新失败');
      return res.json() as Promise<{ success: boolean; queued?: number; fetched?: number }>;
    },
    onMutate: () => {
      if (sources) {
        const activeIds = sources.filter((s) => s.isActive).map((s) => s.id);
        setFetchingIds(new Set(activeIds));
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
      const count = data.queued ?? data.fetched ?? 0;
      notifications.show({
        title: '已加入更新队列',
        message: `已排队 ${count} 个源，后台正在抓取，稍后自动刷新`,
        color: 'blue',
      });
      startPolling();
    },
    onError: (err: Error) => {
      setFetchingIds(new Set());
      notifications.show({ title: '失败', message: err.message, color: 'red' });
    },
  });

  const isFetchingSource = (id: number) => fetchingIds.has(id);

  const openCreate = () => {
    setEditingSource(undefined);
    open();
  };

  const openEdit = (source: Source) => {
    setEditingSource(source);
    open();
  };

  const closeForm = () => {
    setEditingSource(undefined);
    close();
  };

  const handleSubmit = (values: SourceInput) => {
    if (editingSource) {
      updateMutation.mutate({ id: editingSource.id, values });
    } else {
      createMutation.mutate(values);
    }
  };

  return (
    <>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <Group align="flex-start" gap={0} style={{ minHeight: 'calc(100vh - 80px)' }}>
        <Stack
          w={160}
          gap={0}
          py="md"
          style={{
            borderRight: '1px solid var(--mantine-color-gray-2)',
            flexShrink: 0,
            alignSelf: 'stretch',
          }}
        >
          {adminTabs.map((item) => (
            <NavLink
              key={item.value}
              label={item.label}
              leftSection={<item.icon size={18} />}
              active={tab === item.value}
              onClick={() => navigate({ to: '/fish', search: { tab: item.value } })}
              variant="light"
              style={{ borderRadius: 0 }}
            />
          ))}
        </Stack>

        <ScrollArea style={{ flex: 1, alignSelf: 'stretch' }}>
          <Stack gap="md" p="md">
            {tab === 'sources' && (
              <>
                <Group justify="space-between" align="center">
                  {selectedCount > 0 ? (
                    <Group gap="sm">
                      <Text size="sm" fw={500}>
                        已选 {selectedCount} 项
                      </Text>
                      <Button
                        size="xs"
                        variant="default"
                        loading={batchToggleActiveMutation.isPending}
                        onClick={() =>
                          batchToggleActiveMutation.mutate({
                            ids: Array.from(selectedIds),
                            isActive: true,
                          })
                        }
                      >
                        批量启用
                      </Button>
                      <Button
                        size="xs"
                        variant="default"
                        loading={batchToggleActiveMutation.isPending}
                        onClick={() =>
                          batchToggleActiveMutation.mutate({
                            ids: Array.from(selectedIds),
                            isActive: false,
                          })
                        }
                      >
                        批量停用
                      </Button>
                      <Button
                        size="xs"
                        color="red"
                        variant="light"
                        onClick={() => setDeletingBatch(true)}
                      >
                        批量删除
                      </Button>
                      <Button size="xs" variant="subtle" onClick={clearSelection}>
                        取消选择
                      </Button>
                    </Group>
                  ) : (
                    <Text size="sm" c="dimmed">
                      资讯源列表
                    </Text>
                  )}
                  <Group gap="sm">
                    <Button
                      leftSection={<IconRefresh size={16} />}
                      size="xs"
                      variant="default"
                      loading={fetchAllMutation.isPending}
                      onClick={() => fetchAllMutation.mutate()}
                    >
                      更新全部
                    </Button>
                    <Button leftSection={<IconPlus size={16} />} onClick={openCreate} size="xs">
                      添加资讯源
                    </Button>
                  </Group>
                </Group>

                <LoadingOverlay visible={isLoading} />

                <Card withBorder>
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <Table highlightOnHover>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th w={36}>
                            <Checkbox
                              aria-label="全选"
                              checked={allSelected}
                              indeterminate={someSelected}
                              onChange={toggleSelectAll}
                            />
                          </Table.Th>
                          <Table.Th w={40}></Table.Th>
                          <Table.Th w={60}>ID</Table.Th>
                          <Table.Th>名称</Table.Th>
                          <Table.Th>RSS</Table.Th>
                          <Table.Th>频率</Table.Th>
                          <Table.Th>状态</Table.Th>
                          <Table.Th>上次抓取</Table.Th>
                          <Table.Th>操作</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <SortableContext
                        items={sortedSources.map((s) => s.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <Table.Tbody>
                          {sortedSources.map((source) => (
                            <SortableRow
                              key={source.id}
                              source={source}
                              isFetching={isFetchingSource(source.id)}
                              isSelected={selectedIds.has(source.id)}
                              onToggleSelect={() => toggleSelect(source.id)}
                              onFetch={() => fetchMutation.mutate(source.id)}
                              onEdit={() => openEdit(source)}
                              onDelete={() => setDeletingSource(source)}
                              onToggleActive={() =>
                                toggleActiveMutation.mutate({
                                  id: source.id,
                                  isActive: !source.isActive,
                                })
                              }
                            />
                          ))}
                        </Table.Tbody>
                      </SortableContext>
                    </Table>
                  </DndContext>
                </Card>

                <Modal
                  opened={opened}
                  onClose={closeForm}
                  title={editingSource ? '编辑资讯源' : '添加资讯源'}
                  centered
                >
                  <SourceForm source={editingSource} onSubmit={handleSubmit} onCancel={closeForm} />
                </Modal>

                <Modal
                  opened={!!deletingSource}
                  onClose={() => setDeletingSource(undefined)}
                  title="确认删除"
                  size="sm"
                  centered
                >
                  <Text size="sm" mb="lg">
                    确定要删除「{deletingSource?.name}」吗？该操作不可撤销。
                  </Text>
                  <Group justify="flex-end" gap="sm">
                    <Button variant="default" onClick={() => setDeletingSource(undefined)}>
                      取消
                    </Button>
                    <Button
                      color="red"
                      loading={deleteMutation.isPending}
                      onClick={() => {
                        if (deletingSource) deleteMutation.mutate(deletingSource.id);
                        setDeletingSource(undefined);
                      }}
                    >
                      删除
                    </Button>
                  </Group>
                </Modal>

                <Modal
                  opened={deletingBatch}
                  onClose={() => setDeletingBatch(false)}
                  title="确认批量删除"
                  size="sm"
                  centered
                >
                  <Text size="sm" mb="lg">
                    确定要删除选中的 {selectedCount}{' '}
                    个资讯源吗？相关文章将一并删除，该操作不可撤销。
                  </Text>
                  <Group justify="flex-end" gap="sm">
                    <Button variant="default" onClick={() => setDeletingBatch(false)}>
                      取消
                    </Button>
                    <Button
                      color="red"
                      loading={batchDeleteMutation.isPending}
                      onClick={() => batchDeleteMutation.mutate(Array.from(selectedIds))}
                    >
                      删除
                    </Button>
                  </Group>
                </Modal>
              </>
            )}
          </Stack>
        </ScrollArea>
      </Group>
    </>
  );
}
