import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const base = process.argv[2] || 'http://localhost:3100';
const output = process.argv[3] || '.migration-audit/image-performance';
const paths = ['/cruises', '/hotels', '/product/platform-966c4cbc24d6', '/hotels/78f1e093-b4dd-4b13-b325-8084aed66eaa'];
const browser = await puppeteer.launch({ headless: true });
const results = [];
await mkdir(output, { recursive: true });
try {
  for (const width of [390, 1440]) {
    for (const path of paths) {
      const page = await browser.newPage();
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
      await page.setCacheEnabled(false);
      const session = await page.createCDPSession();
      await session.send('Network.enable');
      const requests = new Map();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      session.on('Network.responseReceived', ({ requestId, type, response }) => {
        if (type === 'Image') requests.set(requestId, { url: response.url, status: response.status, bytes: 0 });
      });
      session.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
        if (requests.has(requestId)) requests.get(requestId).bytes = encodedDataLength;
      });
      const snapshot = () => ({ count: requests.size, bytes: [...requests.values()].reduce((sum, entry) => sum + entry.bytes, 0) });
      try {
        const started = Date.now();
        const response = await page.goto(base + path, { waitUntil: 'networkidle0', timeout: 90_000 });
        assert.equal(response.status(), 200);
        const initial = { ...snapshot(), settledMs: Date.now() - started };
        await page.screenshot({ path: `${output}/${width}-${path.split('/').at(-1)}.png` });
        await page.evaluate(async () => {
          for (let y = 0; y < document.documentElement.scrollHeight; y += 600) {
            window.scrollTo(0, y);
            await new Promise((resolve) => setTimeout(resolve, 80));
          }
        });
        await page.waitForNetworkIdle({ idleTime: 500, timeout: 60_000 });
        const scrolled = snapshot();
        let lightbox = null;
        if (path.startsWith('/product/') || path.startsWith('/hotels/')) {
          await page.click('.product-image-button');
          await page.waitForSelector('.cruise-lightbox');
          await page.waitForNetworkIdle({ idleTime: 500, timeout: 60_000 });
          lightbox = { ...snapshot(), thumbnails: await page.$$eval('.lightbox-thumbnails button', (buttons) => buttons.length) };
          const next = await page.$('[aria-label="다음 이미지"]');
          if (next) {
            await next.click();
            await page.waitForNetworkIdle({ idleTime: 500, timeout: 60_000 });
            assert.ok((await page.$eval('.cruise-lightbox-panel footer p strong', (el) => el.textContent)).startsWith('2 /'));
          }
          await page.screenshot({ path: `${output}/${width}-${path.split('/').at(-1)}-lightbox.png` });
          await page.keyboard.press('Escape');
          await page.waitForSelector('.cruise-lightbox', { hidden: true });
        }
        const state = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          brokenImages: [...document.images].filter((img) => img.complete && !img.naturalWidth).map((img) => img.currentSrc),
        }));
        assert.equal(state.overflow, false);
        assert.equal(state.brokenImages.length, 0);
        assert.equal(errors.length, 0);
        assert.ok([...requests.values()].every((entry) => entry.status < 400));
        const result = { path, width, initial, scrolled, lightbox, ...state, errors, images: [...requests.values()] };
        results.push(result);
        console.log(JSON.stringify({ path, width, initial, scrolled, lightbox }));
      } catch (error) {
        results.push({ path, width, error: error.message, errors, images: [...requests.values()] });
        console.error(path, width, error.message);
        process.exitCode = 1;
      } finally { await page.close(); }
    }
  }
} finally {
  await browser.close();
  await writeFile(`${output}/report.json`, JSON.stringify(results, null, 2));
}
