import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    // Playwright writes traces here while tests run; watching them crashes the server on Windows (EBUSY).
    watch: { ignored: ['**/e2e-results/**', '**/e2e/**'] },
  },
  // Scan every page up front, so the dev server never re-bundles Astryx and
  // reloads the tab the first time a lazy page is opened (that reload loses
  // the in-memory sign-in).
  // Test files are not pages: their Node-only imports (msw/node) must stay out of the browser bundle.
  optimizeDeps: { entries: ['index.html', 'src/**/*.tsx', '!src/**/*.test.tsx'] },
  build: {
    // Source maps stay out of the public bundle; upload them to error tracking separately if needed.
    sourcemap: false,
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
