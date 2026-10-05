import { defineConfig } from 'vite';

// Relative base so the static build runs from any folder.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    // three alone is about 600 kB minified, so the default 500 kB warning
    // would fire on every build of a one-page app that cannot avoid it.
    chunkSizeWarningLimit: 900,
  },
});
