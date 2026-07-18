import { Alert, Button, Container } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import type { QueryClient } from '@tanstack/react-query';
import { dehydrate, hydrate } from '@tanstack/react-query';
import { createRouter as createTanStackRouter, Link } from '@tanstack/react-router';
import { queryClient as defaultQueryClient } from './queryClient';
import { routeTree } from './routeTree.gen';

export interface RouterContext {
  queryClient: QueryClient;
}

function RouterErrorComponent({ error }: { error: Error }) {
  return (
    <Container size="md" py="xl">
      <Alert icon={<IconAlertCircle size={16} />} title="加载失败" color="red">
        {error.message || '页面加载出错，请稍后重试'}
      </Alert>
      <Button component={Link} to="/" mt="md" variant="default">
        返回首页
      </Button>
    </Container>
  );
}

export function createRouter(options?: { queryClient?: QueryClient; manifest?: unknown }) {
  const { queryClient: queryClientOption, manifest } = options ?? {};
  const qc = queryClientOption ?? defaultQueryClient;
  return createTanStackRouter({
    routeTree,
    defaultPreload: 'intent',
    defaultErrorComponent: RouterErrorComponent,
    context: {
      queryClient: qc,
    },
    dehydrate: () => ({
      dehydratedState: dehydrate(qc),
    }),
    hydrate: (data) => {
      if (data.dehydratedState) {
        hydrate(qc, data.dehydratedState);
      }
    },
    ...(manifest ? { manifest } : {}),
  });
}

const router = createRouter();

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
