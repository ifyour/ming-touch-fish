import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/web/app/server/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.output/**', 'apps/web/test/**'],
    globals: false,
  },
});
