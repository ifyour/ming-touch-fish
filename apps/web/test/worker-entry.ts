import type { ExecutionContext } from '@cloudflare/workers-types';
import app from '../app/server/app';
import type { Bindings } from '../app/server/types';

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
};
