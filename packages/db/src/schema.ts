import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const sources = sqliteTable(
  'sources',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    url: text('url').notNull(),
    priority: integer('priority').notNull().default(0),
    fetchFrequency: text('fetch_frequency', { enum: ['hourly', 'twice_daily', 'daily'] })
      .notNull()
      .default('daily'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    priorityIdx: index('sources_priority_idx').on(table.priority),
  })
);

export const articles = sqliteTable(
  'articles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: integer('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    translatedTitle: text('translated_title'),
    url: text('url').notNull(),
    publishedAt: integer('published_at', { mode: 'timestamp' }),
    fetchedAt: integer('fetched_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    metadata: text('metadata', { mode: 'json' }),
  },
  (table) => ({
    urlIdx: uniqueIndex('articles_url_idx').on(table.url),
    sourcePublishedIdx: index('articles_source_published_idx').on(table.sourceId, table.publishedAt),
  })
);

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
