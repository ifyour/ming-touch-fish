import type { D1Database, Queue } from '@cloudflare/workers-types';

export interface Bindings {
  DB: D1Database;
  NEWS_QUEUE: Queue<QueueMessage>;
  DIRECT_FETCH?: string;
  DEEPL_API_KEY?: string;
}

export interface QueueMessage {
  sourceId: number;
}
