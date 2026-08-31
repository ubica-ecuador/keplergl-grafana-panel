import type { PluginOptions } from '@grafana/plugin-e2e';
import { defineConfig, devices } from '@playwright/test';
import { dirname } from 'node:path';

const pluginE2eAuth = `${dirname(require.resolve('@grafana/plugin-e2e'))}/auth`;

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig<PluginOptions>({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  // Each test mounts a full kepler.gl WebGL map, rendered by SwiftShader —
  // CPU-bound and memory-hungry — which is the mechanism behind both numbers
  // below.
  //
  // Two locally, not four: at four workers the suite was non-deterministic, a
  // different trio of failures every run, each one passing in isolation. Two
  // keeps it deterministic at roughly the same wall-clock, since the
  // bottleneck is the CPU the maps share rather than the number of tests in
  // flight.
  //
  // One on CI: the GitHub Actions runner has two cores. Measured 2026-08-31 on
  // a loaded developer machine: at two workers 44/48 passed, with all four
  // failures in `flowfield.spec.ts` and all four on the same assertion; that
  // spec alone at one worker gave 5/5. The flow field traces thousands of
  // streamlines and is the first thing to starve, so it is the canary rather
  // than the culprit.
  workers: process.env.CI ? 1 : 2,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.GRAFANA_URL || 'http://localhost:3000',

    /*
     * plugin-e2e logs in as admin/admin by default, which breaks the moment
     * anyone changes the password on their dev instance. Override with
     * GRAFANA_ADMIN_USER / GRAFANA_ADMIN_PASSWORD.
     */
    user: {
      user: process.env.GRAFANA_ADMIN_USER || 'admin',
      password: process.env.GRAFANA_ADMIN_PASSWORD || 'admin',
    },

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    // 1. Login to Grafana and store the cookie on disk for use in other tests.
    {
      name: 'auth',
      testDir: pluginE2eAuth,
      testMatch: [/.*\.js/],
    },
    // 2. Run tests in Google Chrome. Every test will start authenticated as admin user.
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/admin.json',
      },
      dependencies: ['auth'],
    },
  ],
});
