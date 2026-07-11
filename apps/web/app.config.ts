import { fileURLToPath } from 'node:url';
import { defineConfig } from '@tanstack/react-start/config';

const canvasStub = fileURLToPath(new URL('./app/server/lib/canvas-stub.mjs', import.meta.url));

export default defineConfig({
  server: {
    preset: 'cloudflare-pages',
    unenv: {},
    rollupConfig: {
      external: ['wrangler', 'canvas'],
    },
  },
  vite: {
    resolve: {
      alias: {
        canvas: canvasStub,
      },
    },
  },
});
