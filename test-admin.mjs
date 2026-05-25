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
    const BASE = 'http://localhost:3000';
    const PARTNER_ID = '455670d1-a261-499e-bcf2-0f04fda346aa';

    // === Login (with patience) ===
    console.log('Step 1: Login...');
    await page.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 20000 });
    await sleep(2000);
    await page.fill('input[placeholder="admin@example.com"]', 'admin@yeosonam.com');
    await page.fill('input[placeholder="••••••••"]', 'admin123!');
    await page.press('input[placeholder="••••••••"]', 'Enter');
    
    // Wait for redirect
    for (let i = 0; i < 25; i++) {
      if (!page.url().includes('/login')) {
        console.log(`  Logged in (${i + 1}s)`);
        break;
      }
      await sleep(1000);
    }
    
    // Wait for admin dashboard to fully load
    await sleep(3000);

    // === Marketing ===
    console.log('\nStep 2: /admin/marketing');
    await page.goto(`${BASE}/admin/marketing`, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
    await sleep(6000);
    await page.screenshot({ path: path.join(screenshotDir, '01-admin-marketing.png'), fullPage: true });
    console.log('  OK');

    // === Search Ads ===
    console.log('\nStep 3: /admin/search-ads');
    await page.goto(`${BASE}/admin/search-ads`, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
    await sleep(6000);
    await page.screenshot({ path: path.join(screenshotDir, '02-admin-search-ads.png'), fullPage: true });
    console.log('  OK');

    // === Affiliates Detail ===
    console.log('\nStep 4: /admin/affiliates/[id]');
    await page.goto(`${BASE}/admin/affiliates/${PARTNER_ID}`, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
    
    // Wait for all async sections to load (they use useEffect with fetch)
    console.log('  Waiting for sections...');
    
    for (let i = 0; i < 20; i++) {
      const bodyText = await page.textContent('body');
      const hasCardNews = bodyText.includes('카드뉴스 콘텐츠');
      const hasAI = bodyText.includes('AI 콘텐츠 인사이트');
      const hasInsightContent = bodyText.includes('테스트 파트너님의') || bodyText.includes('성과 요약');
      
      if (hasCardNews && hasAI && hasInsightContent) {
        console.log(`  All sections loaded (t=${i + 1}s)`);
        break;
      }
      await sleep(1000);
    }
    
    // If insights already exist, no need to generate
    const finalText = await page.textContent('body');
    console.log(`  카드뉴스 콘텐츠: ${finalText.includes('카드뉴스 콘텐츠')}`);
    console.log(`  AI 콘텐츠 인사이트: ${finalText.includes('AI 콘텐츠 인사이트')}`);
    console.log(`  Has content: ${finalText.includes('로딩 중') === false}`);
    
    await page.screenshot({ path: path.join(screenshotDir, '03-affiliate-detail.png'), fullPage: true });
    console.log('  Screenshot saved');

    // === Content Calendar ===
    console.log('\nStep 5: /admin/content-calendar');
    await page.goto(`${BASE}/admin/content-calendar`, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
    await sleep(6000);
    await page.screenshot({ path: path.join(screenshotDir, '04-content-calendar.png'), fullPage: true });
    console.log('  OK');

    console.log('\n=== ALL SCREENSHOTS COMPLETED ===');
    const files = fs.readdirSync(screenshotDir)
      .filter(f => f.endsWith('.png') && !['error.png', 'login-state.png', 'affiliates-page.png', '03a-before-generation.png', '03a-after-generation.png'].includes(f))
      .sort();
    files.forEach(f => {
      const size = fs.statSync(path.join(screenshotDir, f)).size;
      console.log(`  ${f} (${(size / 1024).toFixed(0)} KB)`);
    });

  } catch (err) {
    console.error('Error:', err.message);
    try { await page.screenshot({ path: path.join(screenshotDir, 'error.png'), fullPage: true }); } catch(e) {}
  } finally {
    await browser.close();
    console.log('Browser closed.');
  }
}

main();
