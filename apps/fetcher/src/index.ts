import type { MessageBatch, ScheduledController } from '@cloudflare/workers-types';
import type { Env } from '@repo/ingest';
import { fetchAndStore, getSourcesToFetch } from '@repo/ingest';
import type { QueueMessage } from '@repo/shared';
import { isCloudflareQuotaError } from '@repo/shared';
import { logger } from '@repo/telemetry';

export default {
  async fetch(_request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    return new Response('News fetcher worker is running');
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    logger.info('Cron triggered: scheduling fetches', { service: 'fetcher' });

    const sources = await getSourcesToFetch(env.DB);
    logger.info(`Found ${sources.length} sources to fetch`, { service: 'fetcher' });

    for (const source of sources) {
      try {
        await env.NEWS_QUEUE.send({ sourceId: source.id } satisfies QueueMessage);
        logger.info(`Queued source ${source.id}: ${source.name}`, {
          service: 'fetcher',
          sourceId: source.id,
        });
      } catch (err) {
        logger.error(`Failed to queue source ${source.id}`, {
          service: 'fetcher',
          sourceId: source.id,
          error: err,
        });
      }
    }
  },

  async queue(batch: MessageBatch<QueueMessage>, env: Env, _ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) {
      const sourceId = message.body.sourceId;
      try {
        logger.info(`Processing message for source ${sourceId}`, { service: 'fetcher', sourceId });
        await fetchAndStore(env, sourceId);
        message.ack();
      } catch (err) {
        const quotaMsg = isCloudflareQuotaError(err);
        if (quotaMsg) {
          logger.error(
            `Quota error for source ${sourceId}, acking (retry won't help): ${quotaMsg}`,
            { service: 'fetcher', sourceId, error: err },
          );
          message.ack();
        } else {
          logger.error(`Failed to process source ${sourceId}, will retry`, {
            service: 'fetcher',
            sourceId,
            error: err,
          });
          message.retry();
        }
      }
    }
  },
};
