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

  // Listen to ALL network requests
  const apiRequests = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('/api/')) {
      apiRequests.push({ url: url.substring(0, 120), method: req.method(), type: req.resourceType() });
    }
  });
  
  const apiResponses = [];
  page.on('response', resp => {
    const url = resp.url();
    if (url.includes('/api/')) {
      apiResponses.push({ url: url.substring(0, 120), status: resp.status(), statusText: resp.statusText() });
    }
  });

  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`  [console.error] ${msg.text().substring(0, 150)}`);
  });

  try {
    const BASE = 'http://localhost:3000';

    // Login
    console.log('Login...');
    await page.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 20000 });
    await sleep(2000);
    await page.fill('input[placeholder="admin@example.com"]', 'admin@yeosonam.com');
    await page.fill('input[placeholder="••••••••"]', 'admin123!');
    await page.press('input[placeholder="••••••••"]', 'Enter');
    await sleep(5000);

    // Navigate to affiliates
    console.log('\nGoing to affiliates...');
    await page.goto(`${BASE}/admin/affiliates`, { waitUntil: 'load', timeout: 20000 });
    await sleep(5000);

    // Log all API requests and responses observed so far
    console.log('\n=== API Requests ===');
    apiRequests.forEach(r => console.log(`  ${r.method} ${r.url}`));
    console.log('\n=== API Responses ===');
    apiResponses.forEach(r => console.log(`  ${r.status} ${r.url}`));
    
    // Check page content
    const bodyText = await page.textContent('body');
    console.log(`\nBody contains "테스트": ${bodyText.includes('테스트')}`);
    console.log(`Body contains "등록된 파트너": ${bodyText.includes('등록된 파트너')}`);

    // Try to do another fetch manually using page.evaluate
    console.log('\nTrying direct API call via page...');
    const result = await page.evaluate(async () => {
      try {
        const res = await fetch('/api/affiliates');
        const data = await res.text();
        return { status: res.status, body: data.substring(0, 500) };
      } catch(e) {
        return { error: e.message };
      }
    }).catch(e => ({ error: e.message }));
    console.log('Direct API call:', JSON.stringify(result).substring(0, 400));

  } catch (err) {
    console.error('Fatal:', err.message);
  } finally {
    await browser.close();
  }
}

main();
