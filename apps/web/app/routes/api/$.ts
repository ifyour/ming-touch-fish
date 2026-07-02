import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createAPIFileRoute } from '@tanstack/react-start/api';
import { getEvent } from '@tanstack/react-start/server';
import honoApp from '../../server/app';
import { createMockEnv } from '../../server/mock-env';
import type { Bindings } from '../../server/types';

interface CloudflareContext {
  env: Bindings;
  context?: ExecutionContext;
}

let devBindings: Bindings | null = null;

async function getDevBindings(): Promise<Bindings> {
  if (devBindings) return devBindings;
  try {
    const { getBindingsProxy } = await import('wrangler');
    const proxy = await getBindingsProxy({ configPath: resolve(dirname(fileURLToPath(import.meta.url)), '../../wrangler.toml') });
    devBindings = proxy.bindings as unknown as Bindings;
    return devBindings;
  } catch {
    return createMockEnv();
  }
}

async function handleAPI({ request }: { request: Request }) {
  const event = getEvent();
  const cloudflare = (event.context as { cloudflare?: CloudflareContext }).cloudflare;
  const env = cloudflare?.env ?? (await getDevBindings());
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
