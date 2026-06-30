import type { MessageBatch, ScheduledController } from '@cloudflare/workers-types';
import type { QueueMessage } from '@repo/shared';
import { fetchAndStore, getSourcesToFetch } from './fetcher.js';
import type { Env } from './types.js';

export default {
  async fetch(_request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    return new Response('News fetcher worker is running');
  },

  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log('Cron triggered: scheduling fetches');

    const sources = await getSourcesToFetch(env.DB);
    console.log(`Found ${sources.length} sources to fetch`);

    for (const source of sources) {
      try {
        await env.NEWS_QUEUE.send({ sourceId: source.id } satisfies QueueMessage);
        console.log(`Queued source ${source.id}: ${source.name}`);
      } catch (err) {
        console.error(`Failed to queue source ${source.id}:`, err);
      }
    }
  },

  async queue(batch: MessageBatch<QueueMessage>, env: Env, _ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) {
      try {
        console.log(`Processing message for source ${message.body.sourceId}`);
        await fetchAndStore(env, message.body.sourceId);
        message.ack();
      } catch (err) {
        console.error(`Failed to process source ${message.body.sourceId}:`, err);
        message.retry();
      }
    }
  },
};
