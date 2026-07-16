import puppeteer from 'puppeteer';

const target = process.argv[2] || 'http://localhost:3000/travel-guide';
const width = Number(process.env.BROWSER_WIDTH || 390);
const height = Number(process.env.BROWSER_HEIGHT || 844);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewport({ width, height });
  await page.goto(target, { waitUntil: 'networkidle0', timeout: 30_000 });

  const audit = await page.evaluate(() => ({
    title: document.title,
    heading: document.querySelector('h1, h2')?.textContent?.trim() || null,
    viewportWidth: document.documentElement.clientWidth,
    contentWidth: document.documentElement.scrollWidth,
    travelGuideShortcutCount: document.querySelectorAll('[aria-label="여행 안내 바로가기"]').length,
  }));

  const result = { target, width, height, ...audit, pageErrors };
  console.log(JSON.stringify(result, null, 2));
  if (pageErrors.length || audit.contentWidth > audit.viewportWidth) process.exitCode = 1;
} finally {
  await browser.close();
}
