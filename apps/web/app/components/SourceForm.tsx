import { useEffect, useState } from 'react';
import { Button, Group, NumberInput, Select, Stack, Switch, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDebouncedValue } from '@mantine/hooks';
import type { Source, SourceInput } from '@repo/shared';
import { getApiUrl } from '../utils/apiUrl.js';

interface SourceFormProps {
  source?: Source;
  onSubmit: (values: SourceInput) => void;
  onCancel: () => void;
}

type DetectStatus = 'idle' | 'detecting' | 'found' | 'not_found';

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

  const [rawUrl, setRawUrl] = useState(form.getValues().url);
  const [debouncedUrl] = useDebouncedValue(rawUrl, 800);
  const [detectStatus, setDetectStatus] = useState<DetectStatus>('idle');
  const [detectedFeedUrl, setDetectedFeedUrl] = useState('');

  const isEditing = !!source;

  useEffect(() => {
    if (!debouncedUrl) { setDetectStatus('idle'); return; }
    if (isEditing && debouncedUrl === source.url) { setDetectStatus('idle'); return; }

    setDetectStatus('detecting');

    (async () => {
      try {
        const res = await fetch(await getApiUrl('/api/sources/detect'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: debouncedUrl }),
        });
        const data = await res.json() as { feedUrl: string | null; sourceName?: string | null };
        if (data.feedUrl) {
          setDetectedFeedUrl(data.feedUrl);
          form.setFieldValue('url', data.feedUrl);
          setDetectStatus('found');
        } else {
          setDetectStatus('not_found');
        }
      } catch {
        setDetectStatus('not_found');
      }
    })();
  }, [debouncedUrl]);

  const urlDescription =
    detectStatus === 'detecting' ? '正在探测 RSS 源…' :
    detectStatus === 'found' ? `已发现 RSS 源：${detectedFeedUrl}` :
    detectStatus === 'not_found' ? '未探测到 RSS 源，可手动输入完整订阅地址' :
    undefined;

  const urlError =
    detectStatus === 'not_found'
      ? '未探测到 RSS 源，请确认网址正确，或手动输入 RSS 订阅地址'
      : undefined;

  return (
    <form onSubmit={form.onSubmit(onSubmit)}>
      <Stack gap="md">
        <TextInput label="名称" placeholder="例如：Hacker News" {...form.getInputProps('name')} />
        <TextInput
          label="网址"
          placeholder="https://example.com"
          value={rawUrl}
          onChange={(e) => {
            setRawUrl(e.currentTarget.value);
            form.setFieldValue('url', e.currentTarget.value);
          }}
          error={urlError}
          description={urlDescription}
          inputWrapperOrder={['label', 'input', 'description', 'error']}
        />
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
