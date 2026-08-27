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

  const editPage = await browser.newPage();
  await editPage.goto(`${baseUrl}/booking/cart`, { waitUntil: 'networkidle0', timeout: 30_000 });
  await editPage.evaluate(() => {
    localStorage.setItem('stayhalong-booking-cart-v1', JSON.stringify([
      { id: 'tour:2026-10-03:기존 투어', serviceType: 'tour', productId: 'tour-request', name: '기존 투어', optionName: '상세 조건 매니저 확인', startDate: '2026-10-03', adults: 2, children: 1, infants: 0, quantity: 1, unitPrice: 0, currency: 'VND', priceStatus: 'reference', sourceHref: '/booking/service/tour', metadata: { requestNote: '기존 요청' } },
    ]));
  });
  await editPage.reload({ waitUntil: 'networkidle0' });
  const editHref = await editPage.$eval('.cart-copy a', (element) => element.getAttribute('href'));
  await editPage.goto(`${baseUrl}${editHref}`, { waitUntil: 'networkidle0', timeout: 30_000 });
  await editPage.waitForFunction(() => document.querySelector('#service-name')?.value === '기존 투어' && document.querySelector('#service-date')?.value === '2026-10-03');
  const restored = await editPage.evaluate(() => ({
    name: document.querySelector('#service-name')?.value,
    date: document.querySelector('#service-date')?.value,
    note: document.querySelector('#service-note')?.value,
    submit: document.querySelector('.booking-controls button[type="submit"]')?.textContent.trim(),
  }));
  await editPage.$eval('#service-name', (element, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, '수정된 투어');
  await editPage.click('.booking-controls button[type="submit"]');
  await editPage.waitForFunction(() => JSON.parse(localStorage.getItem('stayhalong-booking-cart-v1') || '[]').some((item) => item.name === '수정된 투어'));
  const editedItems = await editPage.evaluate(() => JSON.parse(localStorage.getItem('stayhalong-booking-cart-v1') || '[]'));
  results.push({ editHref, restored, editedItemCount: editedItems.length, editedItemName: editedItems[0]?.name });
  await editPage.close();

  const authPage = await browser.newPage();
  await authPage.goto(`${baseUrl}/booking/checkout`, { waitUntil: 'networkidle0', timeout: 30_000 });
  results.push({ checkoutUrl: authPage.url(), checkoutHeading: await authPage.$eval('h1, h2', (element) => element.textContent.trim()) });
  await authPage.close();
} finally {
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
const failed = results.slice(0, 2).some((result) => result.cartItems !== 2 || result.headerCount !== '2' || !result.hasExpectedTotal || result.hasOverlay || result.contentWidth > result.viewportWidth || result.pageErrors.length);
const editResult = results[2];
const editFailed = !editResult?.editHref?.includes('editCartItem=tour%3A2026-10-03%3A%EA%B8%B0%EC%A1%B4%20%ED%88%AC%EC%96%B4') || editResult?.restored?.name !== '기존 투어' || editResult?.restored?.date !== '2026-10-03' || editResult?.restored?.note !== '기존 요청' || !editResult?.restored?.submit?.includes('선택 수정 저장') || editResult?.editedItemCount !== 1 || editResult?.editedItemName !== '수정된 투어';
const authResult = results[3];
const authFailed = !authResult?.checkoutUrl?.includes('/login?next=%2Fbooking%2Fcheckout') || authResult?.checkoutHeading !== '로그인';
if (failed || editFailed || authFailed) process.exitCode = 1;
