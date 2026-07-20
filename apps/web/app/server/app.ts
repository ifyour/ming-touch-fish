import { logger } from '@repo/telemetry';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { getAuth, runAuthMigrations } from './auth';
import articlesRoute from './routes/articles';
import faviconRoute from './routes/favicon';
import readRoute from './routes/read';
import sourcesRoute from './routes/sources';
import type { Bindings } from './types';

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', honoLogger());
app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return '*';
      if (origin.startsWith('http://localhost') || origin.includes('pages.dev')) {
        return origin;
      }
      return '';
    },
  }),
);
app.use('*', prettyJSON());

app.onError((err, c) => {
  logger.error('API error', { service: 'web-api', error: err });
  c.header('Cache-Control', 'no-store');
  return c.json({ error: err.message ?? 'Internal Server Error' }, 500);
});

app.route('/api/sources', sourcesRoute);
app.route('/api/articles', articlesRoute);
app.route('/api/favicon', faviconRoute);
app.route('/api/read', readRoute);

// 手动迁移 better-auth 表结构（首次部署或变更后调用一次）。路径故意避开 /api/auth/ 前缀，
// 否则会被下方 /api/auth/* 通配路由接管而返回 404。
app.post('/api/admin-migrate', async (c) => {
  try {
    const auth = getAuth(c.env.DB);
    await runAuthMigrations(auth);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'migration failed' }, 500);
  }
});

// better-auth 端点（/api/auth/*：sign-in/social、session、sign-out、callback/github 等）。
app.on(['POST', 'GET'], '/api/auth/*', (c) => {
  const auth = getAuth(c.env.DB);
  return auth.handler(c.req.raw);
});

app.get('/api/health', (c) => c.json({ status: 'ok' }));

export default app;
