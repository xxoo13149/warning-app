/* eslint-disable import/no-unresolved */
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig(async () => {
  const { default: react } = await import('@vitejs/plugin-react');
  const { default: tailwindcss } = await import('@tailwindcss/vite');

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
    },
    build: {
      target: 'chrome120',
    },
  };
});
