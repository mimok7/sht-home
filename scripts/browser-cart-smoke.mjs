import puppeteer from 'puppeteer';

const baseUrl = process.argv[2] || 'http://localhost:3000';
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const results = [];

try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.setViewport(viewport);
    await page.goto(`${baseUrl}/booking`, { waitUntil: 'networkidle0', timeout: 30_000 });
    await page.waitForFunction(() => !document.querySelector('.header-cart') && ![...document.querySelectorAll('a')].some((link) => link.getAttribute('href') === '/booking/cart'));
    const audit = await page.evaluate(() => ({
      hasHeaderCart: Boolean(document.querySelector('.header-cart')),
      hasCartAction: [...document.querySelectorAll('a')].some((link) => link.getAttribute('href') === '/booking/cart'),
      hasOverlay: Boolean(document.querySelector('[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay')),
      viewportWidth: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth,
    }));
    await page.goto(`${baseUrl}/booking/cart`, { waitUntil: 'networkidle0', timeout: 30_000 });
    audit.cartUrl = page.url();
    audit.cartHeading = await page.$eval('h1', (element) => element.textContent.trim());
    results.push({ ...viewport, ...audit, pageErrors });
    await page.close();
  }

  const authPage = await browser.newPage();
  await authPage.goto(`${baseUrl}/booking/checkout`, { waitUntil: 'networkidle0', timeout: 30_000 });
  results.push({ checkoutUrl: authPage.url(), checkoutHeading: await authPage.$eval('h1, h2', (element) => element.textContent.trim()) });
  await authPage.close();
} finally {
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
const failed = results.slice(0, 2).some((result) => result.hasHeaderCart || result.hasCartAction || !result.cartUrl.includes('/login?next=%2Fbooking%2Fcart') || result.cartHeading !== '로그인' || result.hasOverlay || result.contentWidth > result.viewportWidth || result.pageErrors.length);
const authResult = results[2];
const authFailed = !authResult?.checkoutUrl?.includes('/login?next=%2Fbooking%2Fcheckout') || authResult?.checkoutHeading !== '로그인';
if (failed || authFailed) process.exitCode = 1;
