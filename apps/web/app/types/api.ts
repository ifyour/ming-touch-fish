import type { Article, Source } from '@repo/db';

export interface SourceWithLastFetchCount extends Source {
  lastFetchCount: number;
}

export interface ArticleGroupedBySource {
  source: Source;
  articles: Article[];
  total: number;
}
