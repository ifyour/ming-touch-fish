import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconRefresh, IconTrash, IconEdit } from '@tabler/icons-react';
import type { Source, SourceInput } from '@repo/shared';
import { SourceForm } from '../components/SourceForm.js';
import { getApiUrl } from '../utils/apiUrl.js';

export const Route = createFileRoute('/admin')({
  component: AdminPage,
  loader: async ({ context }) => {
    return context.queryClient.ensureQueryData({
      queryKey: ['sources'],
      queryFn: fetchSources,
    });
  },
});

async function fetchSources(): Promise<Source[]> {
  const response = await fetch(await getApiUrl('/api/sources'));
  if (!response.ok) throw new Error('Failed to load sources');
  return response.json();
}

function AdminPage() {
  const queryClient = useQueryClient();
  const [opened, { open, close }] = useDisclosure(false);
  const [editingSource, setEditingSource] = useState<Source | undefined>(undefined);

  const { data: sources, isLoading } = useSuspenseQuery({
    queryKey: ['sources'],
    queryFn: fetchSources,
  });

  const createMutation = useMutation({
    mutationFn: async (values: SourceInput) => {
      const res = await fetch(await getApiUrl('/api/sources'), {
        method: 'POST',
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
      notifications.show({ title: '成功', message: '资讯源已添加', color: 'green' });
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
      return res.json();
    },
    onSuccess: () => {
      notifications.show({ title: '成功', message: '抓取任务已入队', color: 'blue' });
    },
    onError: (err: Error) => {
      notifications.show({ title: '失败', message: err.message, color: 'red' });
    },
  });

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

  const rows = sources?.map((source) => (
    <Table.Tr key={source.id}>
      <Table.Td>{source.name}</Table.Td>
      <Table.Td>
        <Text size="sm" lineClamp={1} style={{ maxWidth: 240 }}>
          {source.url}
        </Text>
      </Table.Td>
      <Table.Td>{source.priority}</Table.Td>
      <Table.Td>
        <Badge variant="light">{source.fetchFrequency}</Badge>
      </Table.Td>
      <Table.Td>
        <Badge color={source.isActive ? 'green' : 'gray'}>
          {source.isActive ? '启用' : '停用'}
        </Badge>
      </Table.Td>
      <Table.Td>
        <Group gap="xs">
          <Button
            size="xs"
            variant="light"
            leftSection={<IconRefresh size={14} />}
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
            onClick={() => deleteMutation.mutate(source.id)}
          >
            删除
          </Button>
        </Group>
      </Table.Td>
    </Table.Tr>
  ));

  return (
    <Stack gap="md" py="md" pos="relative">
      <LoadingOverlay visible={isLoading} />
      <Group justify="space-between">
        <Title order={2}>资讯源管理</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
          添加资讯源
        </Button>
      </Group>

      <Card withBorder>
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>名称</Table.Th>
              <Table.Th>URL</Table.Th>
              <Table.Th>优先级</Table.Th>
              <Table.Th>频率</Table.Th>
              <Table.Th>状态</Table.Th>
              <Table.Th>操作</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>{rows}</Table.Tbody>
        </Table>
      </Card>

      <Modal opened={opened} onClose={closeForm} title={editingSource ? '编辑资讯源' : '添加资讯源'}>
        <SourceForm source={editingSource} onSubmit={handleSubmit} onCancel={closeForm} />
      </Modal>
    </Stack>
  );
}
