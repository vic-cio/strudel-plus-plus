import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import bundleAudioWorklet from 'vite-plugin-bundle-audioworklet';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve('src/main/index.ts') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve('src/preload/index.ts') } },
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: {
      alias: {
        // These three current upstream modules are not published to npm. The
        // build script fetches their individually pinned files into this cache.
        '@strudel/dough': resolve('.external/strudel/dough/dough.mjs'),
        '@strudel/edo': resolve('.external/strudel/edo/index.mjs'),
        '@strudel/tidal': resolve('.external/strudel/tidal/tidal.mjs'),
      },
    },
    // Stamped into the snapshot so a stale package is visible rather than
    // looking like an app that is not running.
    define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
    // Strudel's audio engine loads its worklet through a `?audioworklet` import
    // in the published webaudio dependencies. Without this there is no sound.
    plugins: [react(), bundleAudioWorklet() as never],
    server: { host: '127.0.0.1' },
    build: {
      rollupOptions: { input: resolve('src/renderer/index.html') },
    },
  },
});
