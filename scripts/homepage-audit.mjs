import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

// Customer reads and unauthenticated authorization probes only.
// Never submits real bookings, payments or login forms.
const base = process.argv[2] || 'http://localhost:3100';
const temporaryBase = process.env.AUDIT_TEMPORARY_BASE || base;
const output = process.env.AUDIT_OUTPUT || '.migration-audit/homepage';
const hostRules = process.env.AUDIT_HOST_RULES || 'MAP stayhalong.test 127.0.0.1';
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--no-proxy-server', `--host-resolver-rules=${hostRules}`] });
const results = [];
const failures = [];
await mkdir(output, { recursive: true });

async function inspectBookingDialog() {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 667, height: 320 });
    await page.goto(temporaryBase, { waitUntil: 'networkidle2' });
    const trigger = 'a[href="https://customer.stayhalong.com/mypage/direct-booking"]';
    await page.click(trigger);
    await page.waitForSelector('[role="dialog"]');
    assert.ok(await page.evaluate(() => document.querySelector('[role="dialog"]').contains(document.activeElement)), 'Dialog must receive focus');
    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), '상품 예약 창 열기 ↗');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '예약 안내 닫기');
    const panel = await page.$eval('[role="dialog"] > section', (element) => ({ top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom, scrollable: element.scrollHeight > element.clientHeight }));
    assert.ok(panel.top >= 0 && panel.bottom <= 321 && panel.scrollable, 'Short screens need a reachable, scrollable dialog');
    await page.screenshot({ path: `${output}/booking-dialog-short-screen.png` });
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="dialog"]', { hidden: true });
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('href')), 'https://customer.stayhalong.com/mypage/direct-booking');
    assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
    results.push({ interaction: 'booking-dialog-focus-scroll-escape', passed: true });
  } catch (error) {
    failures.push({ interaction: 'booking-dialog', message: error.message });
  } finally { await page.close(); }
}

async function inspect(path, width, origin = base) {
  const page = await browser.newPage();
  const errors = [];
  const httpErrors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) httpErrors.push({ status: response.status(), url: response.url() });
  });
  try {
    await page.setViewport({ width, height: 900 });
    const response = await page.goto(new URL(path, origin).href, { waitUntil: 'networkidle2', timeout: 60_000 });
    // Trigger lazy images throughout the page before inspecting their state.
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += 700) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 20_000 }).catch(() => {});
    const state = await page.evaluate(() => ({
      title: document.title,
      heading: document.querySelector('h1')?.textContent.trim(),
      overflow: document.documentElement.scrollWidth > innerWidth,
      brokenImages: [...document.images].filter((img) => img.complete && !img.naturalWidth).map((img) => img.currentSrc || img.src),
      pendingImages: [...document.images].filter((img) => !img.complete).length,
      links: [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((href) => href.startsWith('/')))],
      imageBytes: performance.getEntriesByType('resource').filter((entry) => entry.initiatorType === 'img').reduce((sum, entry) => sum + entry.transferSize, 0),
      logoUrl: document.querySelector('.logo img')?.currentSrc,
      headerMenuCount: document.querySelectorAll('header .nav-links > a').length,
    }));
    const result = { path, origin, width, status: response.status(), finalUrl: page.url(), ...state, errors, httpErrors };
    results.push(result);
    console.log(JSON.stringify({ path, width, status: result.status, heading: state.heading, overflow: state.overflow, brokenImages: state.brokenImages.length, errors: errors.length, httpErrors: httpErrors.length }));
    assert.equal(response.status(), 200, `${path}: HTTP status`);
    assert.equal(state.overflow, false, `${path}: horizontal overflow at ${width}px`);
    assert.equal(errors.length, 0, `${path}: browser errors`);
    assert.equal(state.brokenImages.length, 0, `${path}: broken images`);
    assert.equal(httpErrors.length, 0, `${path}: failed HTTP requests`);
    if (path === '/' && temporaryBase !== base) assert.equal(state.headerMenuCount, origin === temporaryBase ? 0 : 7, 'Domain-specific header menu');
    if (path === '/') await page.screenshot({ path: `${output}/${origin === temporaryBase ? 'temporary' : 'official'}-${width}.png`, fullPage: true });
    return state;
  } catch (error) {
    failures.push({ path, width, message: error.message });
    console.error(error.message);
    return null;
  } finally { await page.close(); }
}

try {
  for (const width of [390, 1440]) {
    await inspect('/', width);
    if (temporaryBase !== base) await inspect('/', width, temporaryBase);
    for (const path of ['/cruises', '/hotels', '/booking', '/booking/cruise', '/booking/service/airport', '/login', '/register', '/forgot', '/travel-guide', '/faq', '/notice', '/privacy', '/terms', '/search?q=하롱']) {
      const state = await inspect(path, width);
      if (path === '/cruises' || path === '/hotels') {
        const detail = state?.links.find((href) => href.startsWith(path === '/cruises' ? '/product/' : '/hotels/'));
        if (detail) await inspect(detail, width);
        else failures.push({ path, width, message: 'No product detail links found' });
      }
    }
  }

  for (const path of ['/admin', '/admin/naver-cafe-import', '/booking/cart', '/booking/checkout', '/booking/reservations', '/booking/reservations/documents']) {
    const response = await fetch(new URL(path, base), { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    const location = response.headers.get('location');
    const passed = [302, 303, 307, 308].includes(response.status) && new URL(location, base).pathname === '/login';
    results.push({ path, status: response.status, location, passed });
    if (!passed) failures.push({ path, message: 'Missing unauthenticated login redirect' });
  }
  const deniedApis = ['/api/admin/data', '/api/admin/images', '/api/admin/booking-documents', '/api/admin/change-requests', '/api/admin/recommendation-priorities', '/api/admin/hotel-recommendation-priorities', '/api/booking/cart', '/api/booking/documents'];
  for (const path of deniedApis) {
    const method = ['/api/admin/images', '/api/admin/booking-documents'].includes(path) ? 'POST' : 'GET';
    const response = await fetch(new URL(path, base), { method, signal: AbortSignal.timeout(20_000), ...(method === 'POST' ? { body: '{}', headers: { 'Content-Type': 'application/json' } } : {}) });
    const passed = [401, 403].includes(response.status);
    results.push({ path, method, status: response.status, passed });
    if (!passed) failures.push({ path, message: `Expected denied access, got ${response.status}` });
  }
  for (const [path, expected] of [['/home', 404], ['/temp-home', 404], ['/api/public-image', 400], ['/api/public-image?r2=admin-change-requests/probe.png', 404], ['/api/public-image?url=https://example.com/image.png', 400], ['/api/public-catalog', 400], ['/api/public-product-detail', 400]]) {
    const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(20_000) });
    results.push({ path, status: response.status, expected });
    if (response.status !== expected) failures.push({ path, message: `Expected ${expected}, got ${response.status}` });
  }
  if (process.env.AUDIT_INTERACTIONS === '1') await inspectBookingDialog();
} catch (error) {
  failures.push({ message: error.message });
} finally {
  await browser.close();
  await writeFile(`${output}/report.json`, JSON.stringify({ base, temporaryBase, results, failures }, null, 2));
  console.log(JSON.stringify({ checks: results.length, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}
