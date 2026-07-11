import type { Source, Article } from '@repo/db';

export type { Source, Article };

export interface QueueMessage {
  sourceId: number;
}

export interface SourceInput {
  name: string;
  url: string;
  fetchFrequency?: 'hourly' | 'twice_daily' | 'daily';
  isActive?: boolean;
}

export interface ApiError {
  error: string;
}
