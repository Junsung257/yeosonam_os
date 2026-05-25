import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const SCREENSHOT_DIR = 'C:\\Users\\admin\\Desktop\\여소남OS\\tmp_screenshots';
mkdirSync(SCREENSHOT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function safeScreenshot(page, name) {
  const path = join(SCREENSHOT_DIR, name);
  try {
    await page.screenshot({ path, timeout: 15000 });
    console.log(`Screenshot saved: ${name} (${existsSync(path) ? 'exists' : 'missing'})`);
  } catch (e) {
    console.log(`Screenshot failed ${name}: ${e.message?.substring(0, 80)}`);
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Step 1-2: Navigate to login page and screenshot
  console.log('=== Step 1: Navigate to /login ===');
  let navOk = false;
  try {
    await page.goto('http://localhost:3002/login', { waitUntil: 'load', timeout: 20000 });
    navOk = true;
    console.log(`Loaded: ${page.url()}`);
  } catch (err) {
    console.log(`Nav warning: ${err.message?.substring(0, 80)}`);
  }

  // Give any JS time to render
  await sleep(3000);
  
  const url = page.url();
  console.log(`URL after wait: ${url}`);
  
  if (url === 'about:blank' || !navOk) {
    // Try again with DOMContentLoaded
    console.log('Retrying navigation...');
    try {
      await page.goto('http://localhost:3002/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(4000);
      console.log(`URL after retry: ${page.url()}`);
    } catch (e) {
      console.log(`Retry failed: ${e.message?.substring(0, 80)}`);
    }
  }

  await safeScreenshot(page, '01-login-page.png');

  // Print interactive elements
  const interactive = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('input, button, textarea, select, [role="button"], [role="textbox"]'));
    return els.slice(0, 15).map(el => ({
      tag: el.tagName,
      type: el.getAttribute('type') || '',
      name: el.getAttribute('name') || '',
      id: el.getAttribute('id') || '',
      placeholder: el.getAttribute('placeholder') || '',
      text: (el.textContent || '').trim().substring(0, 40),
    }));
  }).catch(() => []);
  console.log('\nInteractive elements:', JSON.stringify(interactive, null, 2));

  // Step 3-4: Fill credentials
  console.log('\n=== Step 2: Fill credentials ===');
  let filled = false;
  for (const sel of ['input[type="email"]', 'input[name="email"]', 'input[placeholder*="admin"]', 'input:not([type="hidden"]):not([type="password"])']) {
    const el = await page.$(sel).catch(() => null);
    if (el) {
      await el.click().catch(() => {});
      await el.fill('admin@yeosonam.com').catch(() => {});
      const val = await el.inputValue().catch(() => '');
      if (val === 'admin@yeosonam.com') {
        console.log(`Email filled via selector: ${sel}`);
        filled = true;
        break;
      }
    }
  }
  if (!filled) {
    // Try pressing keys
    const inputs = await page.$$('input:not([type="hidden"])');
    if (inputs.length > 0) {
      await inputs[0].click();
      await page.keyboard.type('admin@yeosonam.com', { delay: 30 });
      console.log('Email typed via keyboard');
    }
  }

  const pwEl = await page.$('input[type="password"]').catch(() => null);
  if (pwEl) {
    await pwEl.click().catch(() => {});
    await pwEl.fill('admin123!').catch(() => {});
    console.log('Password filled');
  }

  await sleep(500);

  // Step 5: Click login button
  console.log('\n=== Step 3: Click login button ===');
  let clicked = false;
  
  // Try by text content
  const btns = await page.$$('button');
  for (const btn of btns) {
    const txt = (await btn.textContent().catch(() => '')).trim();
    console.log(`Button text: "${txt}"`);
    if (txt === '로그인' || txt.toLowerCase().includes('login') || txt === 'Log in' || txt === 'Sign in') {
      await btn.click();
      clicked = true;
      console.log(`Clicked button with text: "${txt}"`);
      break;
    }
  }
  
  if (!clicked) {
    // Click any submit button
    const submitBtn = await page.$('button[type="submit"], input[type="submit"]').catch(() => null);
    if (submitBtn) {
      await submitBtn.click();
      clicked = true;
      console.log('Clicked submit button');
    } else if (btns.length > 0) {
      await btns[0].click();
      clicked = true;
      console.log('Clicked first button as fallback');
    }
  }

  // Step 6: Wait for redirect
  console.log('\n=== Step 4: Wait for redirect ===');
  let redirectDetected = false;
  let finalUrl = page.url();
  
  try {
    await page.waitForURL(u => !u.includes('/login') && u !== 'about:blank', { timeout: 8000 });
    redirectDetected = true;
    finalUrl = page.url();
    console.log(`URL changed! New URL: ${finalUrl}`);
  } catch {
    console.log('No URL change within 8s, waiting more...');
  }
  
  await sleep(3000);
  finalUrl = page.url();
  console.log(`Final URL: ${finalUrl}`);

  // Step 7: Screenshot after login
  console.log('\n=== Step 5: Screenshot after login ===');
  await safeScreenshot(page, '02-after-login.png');

  const bodyText = await page.textContent('body').catch(() => '');
  console.log('\nBody text (first 800):', bodyText.substring(0, 800));

  // Check for errors
  const errorKeywords = ['error', 'wrong', 'invalid', 'incorrect', 'fail', 'not found', '에러', '오류', '실패', '잘못', 'not match', '일치'];
  const errorsFound = errorKeywords.filter(k => bodyText.toLowerCase().includes(k));
  console.log('Error keywords found:', JSON.stringify(errorsFound));

  // Determine if logged in
  const isLoggedIn = redirectDetected || finalUrl.includes('/admin') || (!finalUrl.includes('/login') && finalUrl !== 'about:blank');
  
  if (isLoggedIn) {
    console.log('\n=== Step 6: Navigate to /admin/marketing ===');
    try {
      await page.goto('http://localhost:3002/admin/marketing', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(3000);
      await safeScreenshot(page, '03-marketing-dashboard.png');
      
      const mktText = await page.textContent('body').catch(() => '');
      console.log('\nMarketing page URL:', page.url());
      console.log('Marketing text (first 1200):', mktText.substring(0, 1200));
      console.log('Page length:', mktText.length);
      
      const dataKeywords = ['chart', 'graph', 'table', 'stat', '통계', '차트', '그래프', '테이블', '분석', 'data', 'report', 'dashboard', '메트릭', 'metric', 'kpi', 'performance', '성과', '전환', 'conversion', 'impression', '노출', 'click', '클릭', 'revenue', '매출'];
      const foundData = dataKeywords.filter(k => mktText.toLowerCase().includes(k));
      console.log('Data/analytics keywords:', JSON.stringify(foundData));
      
    } catch (err) {
      console.log(`Marketing nav error: ${err.message?.substring(0, 100)}`);
      await safeScreenshot(page, '03-marketing-error.png');
    }
  }

  if (consoleErrors.length > 0) {
    console.log('\nConsole errors:', JSON.stringify(consoleErrors.slice(0, 10)));
  }

  await browser.close();
  console.log('\n=== DONE ===');
  
  // Final report
  console.log(JSON.stringify({
    loginSuccess: isLoggedIn,
    finalUrl,
    errorKeywordsFound: errorsFound,
    consoleErrorsCount: consoleErrors.length,
  }));
}

main().catch(e => console.error('FATAL:', e.message?.substring(0, 200)));
