import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { logger } from '@repo/telemetry';
import sourcesRoute from './routes/sources';
import articlesRoute from './routes/articles';
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
  })
);
app.use('*', prettyJSON());

app.onError((err, c) => {
  logger.error('API error', { service: 'web-api', error: err });
  return c.json({ error: err.message ?? 'Internal Server Error' }, 500);
});

app.route('/api/sources', sourcesRoute);
app.route('/api/articles', articlesRoute);

app.get('/api/health', (c) => c.json({ status: 'ok' }));

export default app;
