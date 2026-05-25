import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.join(__dirname, 'screenshots');
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

  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`  [err] ${msg.text().substring(0, 150)}`);
  });

  try {
    const BASE = 'http://localhost:3000';
    const PARTNER_ID = '455670d1-a261-499e-bcf2-0f04fda346aa';

    // Login
    console.log('Login...');
    await page.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 20000 });
    await sleep(2000);
    
    console.log('Filling form...');
    await page.fill('input[placeholder="admin@example.com"]', 'admin@yeosonam.com');
    await page.fill('input[placeholder="••••••••"]', 'admin123!');
    
    console.log('Submitting...');
    await page.press('input[placeholder="••••••••"]', 'Enter');
    
    // Wait for redirect
    for (let i = 0; i < 25; i++) {
      const url = page.url();
      if (!url.includes('/login')) {
        console.log(`Redirected after ${i + 1}s to: ${url.substring(0, 80)}`);
        break;
      }
      await sleep(1000);
    }
    
    // Get cookies
    const cookies = await context.cookies();
    console.log(`\nCookies (${cookies.length}):`);
    cookies.forEach(c => console.log(`  ${c.name}: ${c.value.substring(0, 30)}... (domain=${c.domain}, path=${c.path})`));
    
    // Now directly fetch the affiliate API via page.evaluate
    console.log('\nFetching /api/affiliates via page...');
    const result = await page.evaluate(async (id) => {
      try {
        const res = await fetch(`/api/affiliates?id=${id}&showBankInfo=false`);
        return { status: res.status, ok: res.ok, body: (await res.text()).substring(0, 300) };
      } catch(e) {
        return { error: e.message };
      }
    }, PARTNER_ID);
    console.log('Result:', JSON.stringify(result).substring(0, 400));
    
    // Fetch card-news API
    console.log('\nFetching /api/affiliate/card-news via page...');
    const cardNewsResult = await page.evaluate(async (id) => {
      try {
        const res = await fetch(`/api/affiliate/card-news?affiliate_id=${encodeURIComponent(id)}`);
        return { status: res.status, ok: res.ok, body: (await res.text()).substring(0, 300) };
      } catch(e) {
        return { error: e.message };
      }
    }, PARTNER_ID);
    console.log('Card news result:', JSON.stringify(cardNewsResult).substring(0, 400));
    
    // Fetch insights API
    console.log('\nFetching /api/affiliate/insights via page...');
    const insightResult = await page.evaluate(async (id) => {
      try {
        const res = await fetch(`/api/affiliate/insights?affiliate_id=${encodeURIComponent(id)}&limit=10`);
        return { status: res.status, ok: res.ok, body: (await res.text()).substring(0, 300) };
      } catch(e) {
        return { error: e.message };
      }
    }, PARTNER_ID);
    console.log('Insight result:', JSON.stringify(insightResult).substring(0, 400));
    
    // If card news is empty, generate insight
    const insightBody = insightResult.body || '{}';
    const insights = JSON.parse(insightBody);
    if (insights.insights && insights.insights.length === 0) {
      console.log('\nNo insights found. Generating...');
      const genResult = await page.evaluate(async (id, name) => {
        try {
          const res = await fetch('/api/affiliate/insights', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ affiliate_id: id, affiliate_name: name }),
          });
          return { status: res.status, ok: res.ok, body: (await res.text()).substring(0, 300) };
        } catch(e) {
          return { error: e.message };
        }
      }, PARTNER_ID, '테스트 파트너');
      console.log('Generate result:', JSON.stringify(genResult).substring(0, 300));
    }
    
    // Navigate to the actual page and screenshot
    console.log('\nNavigating to affiliate detail page...');
    await page.goto(`${BASE}/admin/affiliates/${PARTNER_ID}`, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
    await sleep(10000);
    await page.screenshot({ path: path.join(screenshotDir, '03-affiliate-detail.png'), fullPage: true });
    console.log('Screenshot saved');

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
  }
}

main();
