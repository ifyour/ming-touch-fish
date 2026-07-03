import type { D1Database, Queue } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  NEWS_QUEUE: Queue;
  DEEPL_API_KEY: string;
}
