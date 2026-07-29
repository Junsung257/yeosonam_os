import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'next/server': 'C:/dev/yeosonam-os/node_modules/next/server.js',
    },
  },
  test: {
    environment: 'node',
  },
});
