import type { QueryClient } from '@tanstack/react-query';
import { dehydrate, hydrate } from '@tanstack/react-query';
import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { queryClient as defaultQueryClient } from './queryClient';
import { routeTree } from './routeTree.gen';

export interface RouterContext {
  queryClient: QueryClient;
}

export function createRouter(options?: { queryClient?: QueryClient; manifest?: unknown }) {
  const { queryClient: queryClientOption, manifest } = options ?? {};
  const qc = queryClientOption ?? defaultQueryClient;
  return createTanStackRouter({
    routeTree,
    defaultPreload: 'intent',
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
