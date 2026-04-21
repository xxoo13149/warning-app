import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    sourcemap: true,
    target: 'node22',
    rollupOptions: {
      external: [
        'better-sqlite3',
        'ws',
        'bufferutil',
        'utf-8-validate',
        'https-proxy-agent',
      ],
    },
  },
});
