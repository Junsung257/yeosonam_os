import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.resolve(__dirname, '..', 'test-screenshots');
const BASE_URL = 'http://localhost:3000';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ko-KR',
  });
  const page = await context.newPage();

  // Log all console messages
  page.on('console', (msg) => {
    console.log(`  [CONSOLE ${msg.type()}] ${msg.text()}`);
  });

  page.on('pageerror', (err) => {
    console.log(`  [PAGE ERROR] ${err.message}`);
  });

  page.on('response', (resp) => {
    if (resp.status() >= 400) {
      console.log(`  [HTTP ${resp.status()}] ${resp.url().substring(0, 200)}`);
    }
  });

  const results = [];

  // ---- Detailed Login Debug ----
  console.log('\n=== 1. LOGIN DEBUG ===');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'load', timeout: 30000 });
  await sleep(2000);
  console.log('URL:', page.url());
  console.log('Page HTML (first 3000 chars):');
  const html = await page.content();
  console.log(html.substring(0, 3000));

  // Check if Supabase is connected - try to see network
  console.log('\n--- Filling form ---');
  const emailInput = await page.$('input[type="email"]');
  const passwordInput = await page.$('input[type="password"]');
  const submitBtn = await page.$('button[type="submit"]');
  
  console.log('emailInput:', !!emailInput);
  console.log('passwordInput:', !!passwordInput);
  console.log('submitBtn:', !!submitBtn);

  if (emailInput && passwordInput && submitBtn) {
    await emailInput.fill('admin@yeosonam.com');
    await passwordInput.fill('admin123!');
    console.log('Form filled. Clicking submit...');
    await submitBtn.click();
    
    // Wait and check for changes
    await sleep(10000);
    console.log('\nAfter submission:');
    console.log('URL:', page.url());
    
    // Check for error messages
    const errorText = await page.$eval('.text-red-700', el => el.textContent, '로그인 중...').catch(() => null);
    if (errorText) {
      console.log('Error text:', errorText);
    }
    
    // Check for the error div
    const errorDiv = await page.$('[class*="red"]');
    if (errorDiv) {
      const text = await errorDiv.textContent();
      console.log('Error div text:', text?.trim());
    }
    
    // Take screenshot
    await page.screenshot({ path: path.join(screenshotDir, '01-login-debug.png'), fullPage: false });
    results.push({ file: '01-login-debug.png', url: page.url() });

    // Try a second attempt with different approach - maybe the page needs to use the auth API directly
    console.log('\n--- Second attempt: check if auth session cookie is already set ---');
    const cookies = await context.cookies();
    console.log('Cookies:');
    for (const c of cookies) {
      console.log(`  ${c.name}: ${c.value.substring(0, 30)}...`);
    }
  }

  await browser.close();
}

main().catch(console.error);
