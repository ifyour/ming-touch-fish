import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { routeTree } from './routeTree.gen';
import { queryClient as defaultQueryClient } from './queryClient';

export interface RouterContext {
  queryClient: QueryClient;
}

export function createRouter(options?: { queryClient?: QueryClient; manifest?: unknown }) {
  const { queryClient: queryClientOption, manifest } = options ?? {};
  return createTanStackRouter({
    routeTree,
    defaultPreload: 'intent',
    context: {
      queryClient: queryClientOption ?? defaultQueryClient,
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
