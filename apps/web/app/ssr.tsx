import { QueryClient } from '@tanstack/react-query';
import { getRouterManifest } from '@tanstack/react-start/router-manifest';
import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server';
import { createRouter } from './router';

const createRouterFn = () =>
  createRouter({
    queryClient: new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 5 * 60 * 1000,
          retry: 1,
        },
      },
    }),
    manifest: getRouterManifest(),
  });

export default createStartHandler({
  createRouter: createRouterFn,
  getRouterManifest,
})(defaultStreamHandler);
