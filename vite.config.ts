import { defineConfig } from 'vitest/config';
import { loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * VITE_AUTH_MODE=devtoken (`npm run dev` only): API calls go to the same
 * origin and this dev server forwards them to DEV_API_TARGET with the
 * development token attached. The token is read here, in Node, from
 * .env; it is never sent to the browser and never part of a build.
 */
/**
 * Prints one line per proxied API call in the `npm run dev` terminal:
 * time, method, path, status, duration and the API's request id. Never
 * headers or bodies, so no token or content reaches the terminal.
 */
const logApiCalls: ProxyOptions['configure'] = (proxy) => {
  const started = new WeakMap<object, number>();
  const time = () => new Date().toLocaleTimeString('en-GB', { hour12: false });
  const paint = (status: number) => (status >= 500 ? 31 : status >= 400 ? 33 : status >= 300 ? 36 : 32);
  proxy.on('proxyReq', (_proxyReq, req) => { started.set(req, Date.now()); });
  proxy.on('proxyRes', (proxyRes, req) => {
    const status = proxyRes.statusCode ?? 0;
    const ms = Date.now() - (started.get(req) ?? Date.now());
    const id = [proxyRes.headers['x-request-id'] ?? []].flat()[0];
    console.info(`[api] ${time()}  ${(req.method ?? '').padEnd(6)} ${req.url}  \x1b[${paint(status)}m${status}\x1b[0m  ${ms} ms${id ? `  id ${id}` : ''}`);
  });
  proxy.on('error', (err, req) => {
    console.warn(`[api] ${time()}  ${(req.method ?? '').padEnd(6)} ${req.url}  \x1b[31mfailed\x1b[0m  ${(err as NodeJS.ErrnoException).code ?? err.message}`);
  });
};

function devApiProxy(mode: string): Record<string, ProxyOptions> | undefined {
  const env = loadEnv(mode, __dirname, '');
  if (mode === 'simulation') return undefined;
  const target = (env.DEV_API_TARGET ?? '').trim().replace(/\/$/, '');
  // Cognito in `npm run dev` with no API URL yet: forward /v1 to the dev API as it is.
  // The browser sends its own Cognito access token; nothing is added here.
  if (env.VITE_AUTH_MODE === 'cognito') {
    if (!target || (env.VITE_API_BASE_URL ?? '').trim()) return undefined;
    console.info(`\n[dev api] Forwarding /v1 to ${target}; the browser sends its own Cognito access token.\n`);
    return { '/v1': { target, changeOrigin: true, configure: logApiCalls } };
  }
  if (env.VITE_AUTH_MODE !== 'devtoken') return undefined;
  const token = (env.DEV_API_TOKEN ?? '').trim().replace(/^Bearer\s+/i, '');
  if (!target) {
    console.warn('\n[dev api] VITE_AUTH_MODE=devtoken but DEV_API_TARGET is empty in .env; API calls will fail.\n');
    return undefined;
  }
  if (!token) console.warn('\n[dev api] DEV_API_TOKEN is empty in .env; the API will answer 401.\n');
  console.info(`\n[dev api] Forwarding /v1 to ${target} with the development token.\n`);
  return {
    '/v1': {
      target,
      changeOrigin: true,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      configure: logApiCalls,
    },
  };
}

export default defineConfig(({ mode, command }) => ({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    // Playwright writes traces here while tests run; watching them crashes the server on Windows (EBUSY).
    watch: { ignored: ['**/e2e-results/**', '**/e2e/**'] },
    proxy: command === 'serve' && mode !== 'test' ? devApiProxy(mode) : undefined,
  },
  // Scan every page up front, so the dev server never re-bundles Astryx and
  // reloads the tab the first time a lazy page is opened (that reload loses
  // the in-memory sign-in).
  // The Lottie player is imported on demand by a deep path the scan does not
  // pre-bundle; found at runtime, it would reload the tab the same way.
  optimizeDeps: { entries: ['index.html', 'src/**/*.tsx'], include: ['lottie-web/build/player/lottie_light'] },
  build: {
    // Source maps stay out of the public bundle; upload them to error tracking separately if needed.
    sourcemap: false,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
}));
