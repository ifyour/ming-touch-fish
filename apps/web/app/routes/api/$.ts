import { createAPIFileRoute } from '@tanstack/react-start/api';
import { getEvent } from '@tanstack/react-start/server';
import honoApp from '../../server/app';
import { createMockEnv } from '../../server/mock-env';
import type { Bindings } from '../../server/types';

interface CloudflareContext {
  env: Bindings;
  context?: ExecutionContext;
}

async function handleAPI({ request }: { request: Request }) {
  const event = getEvent();
  const cloudflare = (event.context as { cloudflare?: CloudflareContext }).cloudflare;
  const env = cloudflare?.env ?? createMockEnv();
  const ctx = cloudflare?.context;
  return honoApp.fetch(request, env, ctx);
}

export const APIRoute = createAPIFileRoute('/api/$')({
  GET: handleAPI,
  POST: handleAPI,
  PATCH: handleAPI,
  DELETE: handleAPI,
  OPTIONS: handleAPI,
});
