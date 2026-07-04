import type { D1Database, Queue } from '@cloudflare/workers-types';

export interface Bindings {
  DB: D1Database;
  NEWS_QUEUE: Queue<QueueMessage>;
}

export interface QueueMessage {
  sourceId: number;
}
