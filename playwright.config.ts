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
  /*
   * Each test mounts a full kepler.gl WebGL map, rendered by swiftshader in
   * headless Chromium — CPU-bound and memory-hungry. Left uncapped, Playwright
   * spawns one worker per core and the maps starve each other, tipping the
   * heaviest test (save → apply → remount) past its timeout. Cap the workers so
   * every map has room to render.
   *
   * Two, not four: the cross-filter specs grew the suite by half, and at four
   * workers the surviving failures were pure contention — a different trio
   * every run, each passing on its own. Two keeps the suite deterministic at
   * roughly the same wall-clock, since the bottleneck is the CPU the maps
   * share rather than the number of tests in flight.
   */
  workers: 2,
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
