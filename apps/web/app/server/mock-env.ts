import type { D1Database, D1PreparedStatement, D1Result } from '@cloudflare/workers-types';
import type { Bindings } from './types';

class MockPreparedStatement {
  private sql: string;
  private params: unknown[] = [];

  constructor(sql: string) {
    this.sql = sql;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    this.params = values;
    return this as unknown as D1PreparedStatement;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return { success: true, meta: { duration: 0, size_after: 0, rows_read: 0, rows_written: 0, last_row_id: 0, changed_db: false, changes: 0 }, results: [] };
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return { success: true, meta: { duration: 0, size_after: 0, rows_read: 0, rows_written: 0, last_row_id: 0, changed_db: false, changes: 0 }, results: [] };
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    if (options?.columnNames) {
      return [[] as string[]] as [string[], ...T[]];
    }
    return [] as T[];
  }

  first<T = unknown>(_colName: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  async first<T = Record<string, unknown>>(_colName?: string): Promise<T | null> {
    return null;
  }
}

class MockD1Database implements D1Database {
  prepare(query: string): D1PreparedStatement {
    return new MockPreparedStatement(query) as unknown as D1PreparedStatement;
  }

  async batch<T = unknown>(_statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    return [];
  }

  async exec(_query: string): Promise<{ count: number; duration: number }> {
    return { count: 0, duration: 0 };
  }

  withSession(): never { throw new Error('Not implemented'); }
  dump(): Promise<ArrayBuffer> { throw new Error('Not implemented'); }
}

export function createMockEnv(): Bindings {
  return {
    DB: new MockD1Database() as unknown as D1Database,
    NEWS_QUEUE: { send: async () => {} } as unknown as Bindings['NEWS_QUEUE'],
    AI: { run: async () => ({ translated_text: '' }) } as unknown as Bindings['AI'],
  };
}
