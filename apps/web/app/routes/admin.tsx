import { useState } from 'react';
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  Group,
  LoadingOverlay,
  Modal,
  Stack,
  Table,
  Title,
  Text,
  Badge,
  NavLink,
  ScrollArea,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconPlus, IconRefresh, IconTrash, IconEdit, IconRss,
} from '@tabler/icons-react';
import type { Source, SourceInput } from '@repo/shared';
import { SourceForm } from '../components/SourceForm.js';
import { getApiUrl } from '../utils/apiUrl.js';
import { z } from 'zod';

const adminTabs = [
  { value: 'sources', label: '资讯源管理', icon: IconRss },
] as const;

const adminTabSchema = z.enum(['sources']).default('sources');

export const Route = createFileRoute('/admin')({
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

async function fetchSources(): Promise<Source[]> {
  const response = await fetch(await getApiUrl('/api/sources'));
  if (!response.ok) throw new Error('Failed to load sources');
  return response.json();
}

function AdminPage() {
  const { tab } = useSearch({ from: '/admin' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [opened, { open, close }] = useDisclosure(false);
  const [editingSource, setEditingSource] = useState<Source | undefined>(undefined);
  const [deletingSource, setDeletingSource] = useState<Source | undefined>(undefined);

  const { data: sources, isLoading } = useQuery({
    queryKey: ['sources'],
    queryFn: fetchSources,
    staleTime: 5 * 60 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: async (values: SourceInput): Promise<Source> => {
      const res = await fetch(await getApiUrl('/api/sources'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: 'Request failed' }))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<Source>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
      closeForm();
      notifications.show({ title: '成功', message: '资讯源已添加', color: 'green' });
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
        const err = (await res.json().catch(() => ({ error: 'Request failed' }))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
      closeForm();
      notifications.show({ title: '成功', message: '资讯源已更新', color: 'green' });
    },
    onError: (err: Error) => {
      notifications.show({ title: '失败', message: err.message, color: 'red' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(await getApiUrl(`/api/sources/${id}`), { method: 'DELETE' });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: 'Request failed' }))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
      notifications.show({ title: '成功', message: '资讯源已删除', color: 'green' });
    },
    onError: (err: Error) => {
      notifications.show({ title: '失败', message: err.message, color: 'red' });
    },
  });

  const fetchMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(await getApiUrl(`/api/sources/${id}/fetch`), { method: 'POST' });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: 'Request failed' }))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<{ success: boolean; articles: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
      queryClient.invalidateQueries({ queryKey: ['articles', 'grouped'] });
      notifications.show({
        title: '抓取完成',
        message: data.articles > 0 ? `成功获取 ${data.articles} 篇文章` : '没有新文章',
        color: data.articles > 0 ? 'green' : 'blue',
      });
    },
    onError: (err: Error) => {
      notifications.show({ title: '失败', message: err.message, color: 'red' });
    },
  });

  const isFetchingSource = (id: number) => fetchMutation.isPending && fetchMutation.variables === id;

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
      <Group
        align="flex-start"
        gap={0}
        style={{ minHeight: 'calc(100vh - 80px)' }}
      >
        <Stack
          w={220}
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
              onClick={() => navigate({ to: '/admin', search: { tab: item.value } })}
              variant="light"
              style={{ borderRadius: 0 }}
            />
          ))}
        </Stack>

        <ScrollArea style={{ flex: 1, alignSelf: 'stretch' }}>
          <Stack gap="md" p="md">
            {tab === 'sources' && (
              <>
                <Group justify="flex-end">
                  <Button leftSection={<IconPlus size={16} />} onClick={openCreate} size="xs">
                    添加资讯源
                  </Button>
                </Group>

                <LoadingOverlay visible={isLoading} />

                <Card withBorder>
                  <Table highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>名称</Table.Th>
                        <Table.Th>RSS</Table.Th>
                        {/* <Table.Th>优先级</Table.Th> */}
                        <Table.Th>频率</Table.Th>
                        <Table.Th>状态</Table.Th>
                        <Table.Th>上次抓取</Table.Th>
                        <Table.Th>操作</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {sources?.map((source) => (
                        <Table.Tr key={source.id}>
                          <Table.Td>{source.name}</Table.Td>
                          <Table.Td>
                            <Text size="sm" lineClamp={1} style={{ maxWidth: 240 }}>
                              {source.url}
                            </Text>
                          </Table.Td>
                          {/* <Table.Td>{source.priority}</Table.Td> */}
                          <Table.Td>
                            <Badge variant="light">{source.fetchFrequency}</Badge>
                          </Table.Td>
                          <Table.Td>
                            <Badge color={source.isActive ? 'green' : 'gray'}>
                              {source.isActive ? '启用' : '停用'}
                            </Badge>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm" c="dimmed">
                              {source.lastFetchedAt
                                ? new Date(source.lastFetchedAt).toLocaleString('zh-CN')
                                : '从未'}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Group gap="xs">
                              <Button
                                size="xs"
                                variant="light"
                                disabled={isFetchingSource(source.id)}
                                leftSection={
                                  <IconRefresh
                                    size={14}
                                    style={isFetchingSource(source.id) ? { animation: 'spin 1s linear infinite' } : undefined}
                                  />
                                }
                                onClick={() => fetchMutation.mutate(source.id)}
                              >
                                抓取
                              </Button>
                              <Button
                                size="xs"
                                variant="default"
                                leftSection={<IconEdit size={14} />}
                                onClick={() => openEdit(source)}
                              >
                                编辑
                              </Button>
                              <Button
                                size="xs"
                                color="red"
                                variant="light"
                                leftSection={<IconTrash size={14} />}
                                onClick={() => setDeletingSource(source)}
                              >
                                删除
                              </Button>
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Card>

                <Modal opened={opened} onClose={closeForm} title={editingSource ? '编辑资讯源' : '添加资讯源'} centered>
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
              </>
            )}
          </Stack>
        </ScrollArea>
      </Group>
    </>
  );
}
