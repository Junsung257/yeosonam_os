import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.join(__dirname, 'screenshots');
import fs from 'fs';

fs.mkdirSync(screenshotDir, { recursive: true });

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ko-KR',
  });
  const page = await context.newPage();

  try {
    // Login
    console.log('Logging in...');
    await page.goto('http://localhost:3000/login', { waitUntil: 'load', timeout: 15000 });
    await sleep(3000);
    
    await page.fill('input[type="email"]', 'admin@yeosonam.com');
    await page.fill('input[type="password"]', 'admin123!');
    await page.click('button[type="submit"]');
    await sleep(5000);
    console.log('URL:', page.url());

    // Go to affiliates
    console.log('\nNavigating to /admin/affiliates...');
    await page.goto('http://localhost:3000/admin/affiliates', { waitUntil: 'load', timeout: 25000 }).catch(() => {});
    await sleep(5000);

    // Dump page HTML to find partner links
    console.log('\n--- Page title:', await page.title());
    console.log('--- URL:', page.url());

    // Get all links
    const links = await page.$$eval('a', els => els.map(a => ({ href: a.href, text: a.textContent.trim().substring(0, 60) })));
    console.log('\nAll links on page:');
    links.forEach((l, i) => { if (l.text || l.href) console.log(`  [${i}] "${l.text}" -> ${l.href.substring(0, 80)}`); });

    // Get all buttons
    const buttons = await page.$$eval('button', els => els.map(b => b.textContent.trim().substring(0, 60)));
    console.log('\nAll buttons:');
    buttons.forEach((b, i) => console.log(`  [${i}] "${b}"`));

    // Get all table cells
    const cells = await page.$$eval('td, th', els => els.map(c => c.textContent.trim().substring(0, 80)));
    console.log('\nAll table cells:');
    cells.forEach((c, i) => { if (c) console.log(`  [${i}] "${c}"`); });

    // Check for any text containing 테스트
    const bodyText = await page.textContent('body');
    const testIndex = bodyText.indexOf('테스트');
    if (testIndex >= 0) {
      const contextText = bodyText.substring(Math.max(0, testIndex - 30), testIndex + 50);
      console.log(`\n테스트 found in context: ...${contextText}...`);
    } else {
      console.log('\n테스트 NOT found anywhere on page');
      // Take a screenshot of what we have
      await page.screenshot({ path: path.join(screenshotDir, 'affiliates-page.png'), fullPage: true });
      
      // Maybe the affiliates need to be loaded - check for loading indicators
      const loadingText = await page.$$eval('[class*="loading"], [class*="skeleton"], [class*="spinner"]', 
        els => els.map(e => e.textContent.trim()).filter(Boolean));
      console.log('Loading indicators:', loadingText.length > 0 ? loadingText.join(', ') : 'none');

      // Check if the page has a search or filter input
      const inputs = await page.$$eval('input', els => els.map(i => ({ placeholder: i.placeholder, type: i.type, id: i.id, name: i.name })));
      console.log('\nInput fields:');
      inputs.forEach(i => console.log(`  type=${i.type} placeholder="${i.placeholder}" id="${i.id}" name="${i.name}"`));
    }

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
  }
}

main();
