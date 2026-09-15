// Renders banner.html to a PNG at 2x (2468x900).
//
//   node brand/banner/render.mjs [out.png]
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../package.json'));
const { chromium } = require('@playwright/test');

const out = process.argv[2] ?? path.join(here, 'banner@2x.png');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1234, height: 450 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(path.join(here, 'banner.html')).href);
await page.waitForFunction(() => window.bannerReady === true, null, { timeout: 30000 });
await page.evaluate(() => document.fonts.ready);
await page.locator('.banner').screenshot({ path: out });
await browser.close();
console.log('saved', out);
