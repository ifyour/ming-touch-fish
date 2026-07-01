import { defineConfig } from '@tanstack/react-start/config';

export default defineConfig({
  server: {
    preset: 'cloudflare-pages',
    unenv: {},
    rollupConfig: {
      external: ['wrangler'],
    },
  },
});
