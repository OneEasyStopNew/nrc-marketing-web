import { defineConfig } from '@playwright/test';

const PORT = 5181;

/**
 * Runs against the dev server in simulation sign-in mode (labelled fixtures).
 * The staging run against real Cognito test identities uses the same specs
 * with E2E_BASE_URL set and the simulation-only cases skipped.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e-results/artifacts',
  fullyParallel: true,
  workers: 4,
  timeout: 60_000,
  reporter: [['list'], ['json', { outputFile: 'e2e-results/report.json' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`,
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'laptop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    env: { VITE_AUTH_MODE: 'simulation' },
  },
});
