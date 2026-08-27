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
    await page.goto(`${baseUrl}/booking/cart`, { waitUntil: 'networkidle0', timeout: 30_000 });
    await page.evaluate(() => {
      localStorage.setItem('stayhalong-booking-cart-v1', JSON.stringify([
        { id: 'cruise:test:2026-10-01', serviceType: 'cruise', productId: 'cruise-test', optionId: 'rate-test', name: '테스트 크루즈', optionName: '발코니 객실 · 1박 2일', startDate: '2026-10-01', adults: 2, children: 1, infants: 0, quantity: 1, unitPrice: 5000000, currency: 'VND', priceStatus: 'reference', sourceHref: '/cruises' },
        { id: 'hotel:test:2026-10-02', serviceType: 'hotel', productId: 'hotel-test', optionId: 'room-test', name: '테스트 호텔', optionName: '디럭스 룸', startDate: '2026-10-02', adults: 2, children: 0, infants: 0, quantity: 2, unitPrice: 1000000, currency: 'VND', priceStatus: 'reference', sourceHref: '/hotels' },
      ]));
    });
    await page.reload({ waitUntil: 'networkidle0' });
    const audit = await page.evaluate(() => ({
      cartItems: document.querySelectorAll('.cart-item').length,
      headerCount: document.querySelector('.header-cart b')?.textContent,
      hasExpectedTotal: document.body.innerText.includes('7,000,000 VND'),
      hasOverlay: Boolean(document.querySelector('[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay')),
      viewportWidth: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth,
    }));
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
const failed = results.slice(0, 2).some((result) => result.cartItems !== 2 || result.headerCount !== '2' || !result.hasExpectedTotal || result.hasOverlay || result.contentWidth > result.viewportWidth || result.pageErrors.length);
const authFailed = !results[2]?.checkoutUrl?.includes('/login?next=%2Fbooking%2Fcheckout') || results[2]?.checkoutHeading !== '로그인';
if (failed || authFailed) process.exitCode = 1;
