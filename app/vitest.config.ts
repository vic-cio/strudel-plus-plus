import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // These build-time upstream modules are intentionally mocked in unit
      // tests, so tests do not need the network-only external artifact cache.
      '@strudel/dough': resolve(__dirname, 'src/renderer/test-modules/empty.mjs'),
      '@strudel/edo': resolve(__dirname, 'src/renderer/test-modules/empty.mjs'),
      '@strudel/tidal': resolve(__dirname, 'src/renderer/test-modules/empty.mjs'),
    },
  },
  test: {
    // Node for the main-process modules, jsdom only where a component asks for
    // it with a `@vitest-environment jsdom` docblock.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
