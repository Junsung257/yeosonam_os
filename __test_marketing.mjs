import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'fs';
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
    console.log(`Screenshot saved: ${name}`);
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
  page.setDefaultTimeout(20000);

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Listen for network responses
  const responses = [];
  page.on('response', resp => {
    const url = resp.url();
    if (url.includes('localhost:3002')) {
      responses.push({ url: url.replace('http://localhost:3002', ''), status: resp.status() });
    }
  });

  // Log in
  console.log('=== Logging in ===');
  await page.goto('http://localhost:3002/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);
  
  await page.fill('input[type="email"]', 'admin@yeosonam.com');
  await page.fill('input[type="password"]', 'admin123!');
  await page.click('button[type="submit"]');
  
  console.log('Submitted login, waiting...');
  await sleep(10000);
  
  console.log(`URL after 10s: ${page.url()}`);
  console.log(`Session cookies:`, JSON.stringify(await page.context().cookies().catch(() => [])));
  
  // Now navigate directly to marketing
  console.log('\n=== Navigating to /admin/marketing ===');
  try {
    await page.goto('http://localhost:3002/admin/marketing', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);
    console.log(`Marketing URL: ${page.url()}`);
    await safeScreenshot(page, '03-marketing-dashboard.png');
    
    const mktText = await page.textContent('body').catch(() => '');
    console.log('\n=== MARKETING PAGE CONTENT ===');
    console.log('Page length:', mktText.length);
    console.log('First 2000 chars:', mktText.substring(0, 2000));
    
    if (mktText.length > 2000) {
      console.log('\nMIDDLE (2000-4000):', mktText.substring(2000, 4000));
      console.log('\nEND (last 500):', mktText.substring(mktText.length - 500));
    }
    
    // Check for specific UI elements
    const keywords = {
      'Data/charts': ['chart', 'graph', 'visualization', '시각화', '차트', '그래프'],
      'Tables': ['table', 'grid', 'list', '테이블', '목록'],
      'Metrics/KPIs': ['metric', 'kpi', 'stat', 'counter', '메트릭', 'kpi', '통계'],
      'Analytics': ['analytics', '분석', 'trend', '트렌드'],
      'Marketing terms': ['campaign', 'ad', '광고', '마케팅', 'marketing', 'channel', '채널'],
      'Performance': ['performance', '성과', 'conversion', '전환', 'impression', '노출', 'click', '클릭', 'revenue', '매출'],
    };
    
    console.log('\n=== CONTENT KEYWORDS ===');
    for (const [category, terms] of Object.entries(keywords)) {
      const found = terms.filter(t => mktText.toLowerCase().includes(t.toLowerCase()));
      if (found.length > 0) {
        console.log(`${category}: ${found.join(', ')}`);
      }
    }
    
    // Check for error/empty states
    const errorIndicators = ['error', 'failed', 'no data', 'empty', '데이터 없음', '오류', '에러', '불러오기 실패'];
    const errorsFound = errorIndicators.filter(e => mktText.toLowerCase().includes(e));
    if (errorsFound.length > 0) {
      console.log('\nERROR/EMPTY INDICATORS:', errorsFound);
    }
    
  } catch (err) {
    console.log(`Marketing navigation error: ${err.message?.substring(0, 100)}`);
    await safeScreenshot(page, '03-marketing-error.png');
  }

  // Print network responses
  console.log('\n=== NETWORK RESPONSES ===');
  for (const r of responses) {
    console.log(`${r.status} ${r.url}`);
  }

  if (consoleErrors.length > 0) {
    console.log('\n=== CONSOLE ERRORS ===');
    consoleErrors.slice(0, 10).forEach(e => console.log(e.substring(0, 200)));
  }

  await browser.close();
  console.log('\n=== DONE ===');
}

main().catch(e => console.error('FATAL:', e.message?.substring(0, 200)));
