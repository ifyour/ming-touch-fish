import { Button, Group, NumberInput, Select, Stack, Switch, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import type { Source, SourceInput } from '@repo/shared';

interface SourceFormProps {
  source?: Source;
  onSubmit: (values: SourceInput) => void;
  onCancel: () => void;
}

export function SourceForm({ source, onSubmit, onCancel }: SourceFormProps) {
  const form = useForm<SourceInput>({
    initialValues: {
      name: source?.name ?? '',
      url: source?.url ?? '',
      priority: source?.priority ?? 0,
      fetchFrequency: source?.fetchFrequency ?? 'daily',
      isActive: source?.isActive ?? true,
    },
    validate: {
      name: (value) => (value.trim().length > 0 ? null : '名称不能为空'),
      url: (value) =>
        /^https?:\/\/.+/.test(value) ? null : '请输入有效的 HTTP/HTTPS URL',
    },
  });

  return (
    <form onSubmit={form.onSubmit(onSubmit)}>
      <Stack gap="md">
        <TextInput label="名称" placeholder="例如：Hacker News" {...form.getInputProps('name')} />
        <TextInput label="RSS URL" placeholder="https://example.com/feed.xml" {...form.getInputProps('url')} />
        <NumberInput label="优先级" {...form.getInputProps('priority')} />
        <Select
          label="抓取频率"
          data={[
            { value: 'hourly', label: '每小时' },
            { value: 'twice_daily', label: '每 12 小时' },
            { value: 'daily', label: '每天' },
          ]}
          {...form.getInputProps('fetchFrequency')}
        />
        <Switch label="启用" {...form.getInputProps('isActive', { type: 'checkbox' })} />

        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            取消
          </Button>
          <Button type="submit">{source ? '更新' : '添加'}</Button>
        </Group>
      </Stack>
    </form>
  );
}
