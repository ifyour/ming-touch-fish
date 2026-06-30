import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server';
import { getRouterManifest } from '@tanstack/react-start/router-manifest';
import { createRouter } from './router';
import { queryClient } from './queryClient';

const createRouterFn = () =>
  createRouter({
    queryClient,
    manifest: getRouterManifest(),
  });

export default createStartHandler({
  createRouter: createRouterFn,
  getRouterManifest,
})(defaultStreamHandler);
