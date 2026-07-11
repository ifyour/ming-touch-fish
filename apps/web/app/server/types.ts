import type { D1Database, Queue } from '@cloudflare/workers-types';
import type { QueueMessage } from '@repo/shared';

export interface Bindings {
  DB: D1Database;
  NEWS_QUEUE: Queue<QueueMessage>;
  DIRECT_FETCH?: string;
  DEEPL_API_KEY?: string;
  FIRECRAWL_API_KEY?: string;
  GEMINI_API_KEY?: string;
}
