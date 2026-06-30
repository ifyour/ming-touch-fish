import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.D1_DATABASE_PATH ?? './.wrangler/state/d1/DB.sqlite3',
  },
});
