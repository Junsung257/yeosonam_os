/**
 * @file db/render_card_news_to_png.mjs
 *
 * 카드뉴스 HTML 파일을 6장 PNG로 렌더링.
 * Anthropic API 호출 없음 — Puppeteer 로컬 처리만.
 *
 * 사용:
 *   node db/render_card_news_to_png.mjs scratch/phuquoc_2026-04-25T10-37-36.html
 *   node db/render_card_news_to_png.mjs <html_path> [--scale=1|2|3]
 *
 * 출력:
 *   scratch/<basename>_pngs/01.png ~ 06.png
 *   인스타 권장: 1080×1080 (scale=1) / 고해상도: 2160×2160 (scale=2)
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function parseArgs() {
  const args = process.argv.slice(2);
  let htmlArg = null;
  let scale = 2;
  for (const a of args) {
    if (a.startsWith('--scale=')) {
      scale = Number(a.slice('--scale='.length)) || 2;
    } else if (!htmlArg && !a.startsWith('--')) {
      htmlArg = a;
    }
  }
  return { htmlArg, scale };
}

async function main() {
  const { htmlArg, scale } = parseArgs();
  if (!htmlArg) {
    console.error('사용: node db/render_card_news_to_png.mjs <html_path> [--scale=1|2]');
    process.exit(1);
  }

  const htmlPath = path.isAbsolute(htmlArg) ? htmlArg : path.resolve(ROOT, htmlArg);
  const exists = await fs.stat(htmlPath).catch(() => null);
  if (!exists) {
    console.error(`HTML 파일 없음: ${htmlPath}`);
    process.exit(1);
  }

  const baseName = path.basename(htmlPath, '.html');
  const outDir = path.resolve(ROOT, 'scratch', `${baseName}_pngs`);
  await fs.mkdir(outDir, { recursive: true });

  const url = 'file:///' + htmlPath.replace(/\\/g, '/');
  console.log(`▶ 렌더 시작`);
  console.log(`  HTML : ${path.relative(ROOT, htmlPath)}`);
  console.log(`  출력 : scratch/${baseName}_pngs/`);
  console.log(`  scale: ${scale}x (=${1080 * scale}×${1080 * scale}px)`);
  console.log('');

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=none',
    ],
  });

  const t0 = Date.now();
  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: 1080,
      height: 1080,
      deviceScaleFactor: scale,
    });

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });

    // 폰트 + 외부 자원 로드 안정화
    await page.evaluate(() => document.fonts.ready);
    await new Promise((r) => setTimeout(r, 1500));

    const cardCount = await page.$$eval('.card', (els) => els.length);
    console.log(`  카드 ${cardCount}장 감지`);

    if (cardCount === 0) {
      throw new Error('카드(.card) 엘리먼트가 발견되지 않았습니다');
    }

    for (let i = 0; i < cardCount; i++) {
      const cards = await page.$$('.card');
      const card = cards[i];
      const filename = `${String(i + 1).padStart(2, '0')}.png`;
      const filePath = path.join(outDir, filename);

      // element.screenshot 은 viewport 밖 element 도 자동 스크롤 후 캡처
      await card.screenshot({
        path: filePath,
        type: 'png',
        captureBeyondViewport: true,
      });

      const stat = await fs.stat(filePath);
      console.log(`  ✓ ${filename}  (${(stat.size / 1024).toFixed(0)} KB)`);
    }
  } finally {
    await browser.close();
  }

  const dt = Date.now() - t0;
  console.log('');
  console.log(`✅ 완료 (${(dt / 1000).toFixed(1)}s)`);
  console.log(`  폴더: file:///${outDir.replace(/\\/g, '/')}`);
}

main().catch((err) => {
  console.error('❌ 렌더 실패:', err?.message || err);
  process.exit(1);
});
