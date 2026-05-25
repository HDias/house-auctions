import cron from 'node-cron';
import { chromium } from 'playwright';

async function scrape() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('https://example.com');

  const data = await page.evaluate(() => {
    return document.querySelector('h1')?.innerText;
  });

  console.log('Scraped:', data);

  await browser.close();
}

// run daily at 8am
cron.schedule('0 8 * * *', () => {
  console.log('Running daily scrape...');
  scrape();
});

console.log('Scheduler running...');