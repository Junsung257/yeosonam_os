import { chromium } from 'playwright';
import path from 'path';
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

  page.on('response', (resp) => {
    if (resp.status() >= 400) {
      console.log(`  [HTTP ${resp.status()}] ${resp.url()}`);
    }
  });

  const results = [];

  // ---- 1. LOGIN ----
  console.log('\n=== Step 1: Login ===');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'load', timeout: 30000 });
  await sleep(2000);
  await page.fill('input[type="email"]', 'admin@yeosonam.com');
  await page.fill('input[type="password"]', 'admin123!');
  await page.click('button[type="submit"]');
  await sleep(5000);
  console.log('Login URL:', page.url());
  if (page.url().includes('/login')) {
    // Retry once
    await page.fill('input[type="email"]', 'admin@yeosonam.com');
    await page.fill('input[type="password"]', 'admin123!');
    await page.click('button[type="submit"]');
    await sleep(5000);
    console.log('Retry URL:', page.url());
  }

  // ---- 2. AFFILIATES LIST AND FIND TEST PARTNER ----
  console.log('\n=== Step 2: Navigate to affiliates page ===');
  await page.goto(`${BASE_URL}/admin/affiliates`, { waitUntil: 'load', timeout: 60000 });
  await sleep(5000);
  
  // Read all affiliates data from the table
  const affiliatesData = await page.$$eval('table tbody tr', (rows) => {
    return rows.map(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 9) return null;
      const name = cells[0]?.textContent?.trim() || '';
      const detailLink = cells[8]?.querySelector('a');
      const href = detailLink?.getAttribute('href') || '';
      return { name, href };
    }).filter(Boolean);
  });
  
  console.log('Affiliates found:');
  for (const a of affiliatesData) {
    console.log(`  name="${a.name}", href="${a.href}"`);
  }

  // Find the test partner
  const testPartner = affiliatesData.find(a => a.name.includes('테스트'));
  let detailUrl = '';
  
  if (testPartner) {
    detailUrl = testPartner.href;
    console.log(`\nFound 테스트 파트너: name="${testPartner.name}", href="${detailUrl}"`);
  } else if (affiliatesData.length > 0) {
    // Use the first affiliate
    detailUrl = affiliatesData[0].href;
    console.log(`\nNo 테스트 파트너 found. Using first affiliate: name="${affiliatesData[0].name}", href="${detailUrl}"`);
  } else {
    console.log('\nNo affiliates found in table. Taking screenshot of empty state.');
    await page.screenshot({ path: path.join(screenshotDir, '07-empty-affiliates.png'), fullPage: true });
    results.push({ file: '07-empty-affiliates.png', url: page.url(), description: '제휴사 목록 - 데이터 없음' });
  }

  if (detailUrl) {
    // Navigate to affiliate detail
    console.log(`\n=== Step 3: Navigate to affiliate detail: ${detailUrl} ===`);
    await page.goto(`${BASE_URL}${detailUrl}`, { waitUntil: 'load', timeout: 60000 });
    await sleep(5000);
    console.log('Detail URL:', page.url());

    // Get page structure for debugging
    const sections = await page.$$eval('h2, h3, h4, strong, b, [class*="title"], [class*="Section"]', (els) =>
      els.map(el => ({ tag: el.tagName, text: el.textContent?.trim().substring(0, 80) || '' }))
    );
    console.log('Page sections/headings:');
    for (const s of sections) {
      if (s.text) console.log(`  ${s.tag}: ${s.text}`);
    }

    // Take screenshot of affiliate detail
    await page.screenshot({ path: path.join(screenshotDir, '08-affiliate-detail.png'), fullPage: true });
    results.push({ file: '08-affiliate-detail.png', url: page.url(), description: '제휴사 상세 페이지' });

    // Find all buttons
    const buttons = await page.$$eval('button', (btns) =>
      btns.map(b => ({ text: b.textContent?.trim() || '', type: b.getAttribute('type') || '' }))
    );
    console.log('Buttons:', buttons.map(b => `"${b.text}"`).join(', '));

    // Find insight/생성 button
    const insightBtn = buttons.find(b => b.text.includes('인사이트') || b.text.includes('생성') || b.text.includes('insight') || b.text.includes('통계'));
    if (insightBtn) {
      console.log(`Clicking insight button: "${insightBtn.text}"`);
      await page.click(`button:has-text("${insightBtn.text}")`);
      await sleep(10000);
      await page.screenshot({ path: path.join(screenshotDir, '09-after-insights.png'), fullPage: true });
      results.push({ file: '09-after-insights.png', url: page.url(), description: 'AI 콘텐츠 인사이트 생성 후' });
    } else {
      console.log('No insight/생성 button found. Checking page content...');
      const pageText = await page.textContent('body') || '';
      const snippets = ['카드뉴스', '콘텐츠', '인사이트', 'AI'];
      for (const snippet of snippets) {
        const matches = pageText.match(new RegExp(`.{0,40}${snippet}.{0,40}`, 'g'));
        if (matches) {
          console.log(`  "${snippet}" references:`, matches.slice(0, 3));
        }
      }
    }
  }

  // ---- 4. Take remaining admin page screenshots ----
  console.log('\n=== Step 4: Other admin pages ===');
  const otherPages = [
    { path: '/admin', name: '02-admin-dashboard', desc: '관리자 메인 대시보드' },
    { path: '/admin/marketing', name: '03-marketing-dashboard', desc: '마케팅 대시보드' },
    { path: '/admin/search-ads', name: '04-search-ads', desc: '검색 광고 대시보드' },
    { path: '/admin/marketing/card-news', name: '05-card-news', desc: '카드뉴스 목록' },
    { path: '/admin/content-calendar', name: '06-content-calendar', desc: '콘텐츠 캘린더' },
  ];

  for (const { path: pagePath, name, desc } of otherPages) {
    console.log(`  ${pagePath}`);
    await page.goto(`${BASE_URL}${pagePath}`, { waitUntil: 'load', timeout: 60000 });
    await sleep(5000);
    await page.screenshot({ path: path.join(screenshotDir, `${name}.png`), fullPage: true });
    results.push({ file: `${name}.png`, url: page.url(), description: desc });
  }

  await browser.close();

  // Summary
  console.log('\n\n========== RESULTS ==========');
  for (const r of results) {
    console.log(`${r.file}: ${r.description}`);
    console.log(`   URL: ${r.url}`);
  }
  console.log(`\n${results.length} screenshots saved to ${screenshotDir}`);
}

main().catch(console.error);
