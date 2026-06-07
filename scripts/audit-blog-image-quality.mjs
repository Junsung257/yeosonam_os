#!/usr/bin/env node

import { chromium } from 'playwright';

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] ?? fallback : fallback;
};
const hasFlag = (name) => args.includes(name);

const baseUrl = (getArg('--base', process.env.BLOG_AUDIT_BASE_URL || 'http://localhost:3000') || '').replace(/\/$/, '');
const limit = Number(getArg('--limit', '0')) || 0;
const concurrency = Math.max(1, Math.min(12, Number(getArg('--concurrency', '6')) || 6));
const outputJson = hasFlag('--json');

const STOP_WORDS = new Set([
  '여소남',
  '여행',
  '완벽',
  '가이드',
  '총정리',
  '체크리스트',
  '추천',
  '최신',
  '기준',
  '날씨',
  '옷차림',
  '준비물',
  '비용',
  '일정',
  'best',
]);

function normalizeToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{Script=Hangul}\p{Letter}\p{Number}]+/gu, '');
}

function titleTokens(title) {
  return [...new Set(String(title || '')
    .replace(/\|\s*여소남.*$/i, '')
    .split(/[^\p{Script=Hangul}\p{Letter}\p{Number}]+/gu)
    .map(normalizeToken)
    .filter((token) => (token.length >= 2 || /^[\p{Script=Hangul}]$/u.test(token)) && !STOP_WORDS.has(token)))]
    .slice(0, 10);
}

async function fetchText(path) {
  const res = await fetch(`${baseUrl}${path}`);
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.text();
}

async function probeImageUrl(url) {
  if (!/^https?:\/\//i.test(url)) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const head = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
    });
    if (head.ok) return true;
    if (![405, 501].includes(head.status)) return false;
    const get = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      signal: controller.signal,
    });
    return get.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function collectBlogLinks() {
  const links = new Set();
  let page = 1;

  while (page <= 20) {
    const path = page === 1 ? '/blog' : `/blog?page=${page}`;
    const html = await fetchText(path);
    const matches = html.matchAll(/href="(\/blog\/[^"#?]+)"/g);
    let before = links.size;
    for (const match of matches) {
      const href = match[1];
      if (!href) continue;
      if (href.startsWith('/blog/angle/') || href.startsWith('/blog/destination/')) continue;
      links.add(href);
    }
    if (links.size === before && page > 1) break;
    if (!html.includes(`page=${page + 1}`) && !html.includes(`>${page + 1}<`)) break;
    page += 1;
  }

  const result = [...links];
  return limit > 0 ? result.slice(0, limit) : result;
}

function summarize(rows) {
  const fetched = rows.filter((row) => !row.error);
  const failed = fetched.filter((row) => row.failed);
  const totalImages = fetched.reduce((sum, row) => sum + row.imageCount, 0);
  const uniqueUrls = new Set(fetched.flatMap((row) => row.images.map((image) => image.src)));
  const domainCounts = {};

  for (const row of fetched) {
    for (const image of row.images) {
      try {
        const host = new URL(image.src).hostname;
        domainCounts[host] = (domainCounts[host] || 0) + 1;
      } catch {
        domainCounts.invalid = (domainCounts.invalid || 0) + 1;
      }
    }
  }

  return {
    baseUrl,
    totalLinks: rows.length,
    fetched: fetched.length,
    errors: rows.length - fetched.length,
    failed: failed.length,
    passed: fetched.length - failed.length,
    score: fetched.length === 0 ? 0 : Math.round(((fetched.length - failed.length) / fetched.length) * 100),
    totalImages,
    uniqueImages: uniqueUrls.size,
    duplicateImageRatio: totalImages === 0 ? 0 : Number((1 - uniqueUrls.size / totalImages).toFixed(3)),
    domainCounts,
  };
}

async function auditPage(page, path) {
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('article, body', { timeout: 15000 }).catch(() => undefined);
  await page.evaluate(async () => {
    const article = document.querySelector('article') || document.body;
    const imgs = [...article.querySelectorAll('img')];
    await Promise.all(imgs.map((img) => {
      if (img.complete) return null;
      return new Promise((resolve) => {
        const done = () => resolve(null);
        const timer = window.setTimeout(done, 3000);
        img.addEventListener('load', () => {
          window.clearTimeout(timer);
          done();
        }, { once: true });
        img.addEventListener('error', () => {
          window.clearTimeout(timer);
          done();
        }, { once: true });
      });
    }));
  });

  const row = await page.evaluate((auditPath) => {
    const article = document.querySelector('article') || document.body;
    const title = document.title || document.querySelector('h1')?.textContent || auditPath;
    const imgs = [...article.querySelectorAll('img')].map((img) => {
      const fig = img.closest('figure')?.querySelector('figcaption') || img.nextElementSibling;
      return {
        src: img.currentSrc || img.src || '',
        alt: img.getAttribute('alt') || '',
        caption: fig?.tagName?.toLowerCase() === 'figcaption' ? fig.textContent?.trim() || '' : '',
        naturalWidth: img.naturalWidth || 0,
        naturalHeight: img.naturalHeight || 0,
        complete: img.complete,
      };
    });

    return { path: auditPath, title, images: imgs };
  }, path);

  row.images = await Promise.all(row.images.map(async (image) => ({
    ...image,
    reachable: image.naturalWidth > 0 && image.naturalHeight > 0
      ? true
      : await probeImageUrl(image.src),
  })));

  return row;
}

function judge(row) {
  const tokens = titleTokens(row.title);
  const seen = new Set();
  const duplicateUrls = [];
  let missingAlt = 0;
  let broken = 0;
  let tiny = 0;
  let contextual = 0;

  for (const image of row.images) {
    if (image.reachable === false) broken += 1;
    if (image.naturalWidth > 0 && image.naturalWidth < 320) tiny += 1;
    if ((image.alt || '').trim().length < 3) missingAlt += 1;
    if (seen.has(image.src)) duplicateUrls.push(image.src);
    seen.add(image.src);

    const text = normalizeToken(`${image.alt} ${image.caption}`);
    if (tokens.some((token) => text.includes(token))) contextual += 1;
  }

  const imageCount = row.images.length;
  const issues = [];
  if (imageCount === 0) issues.push('no_article_images');
  if (broken > 0) issues.push('broken_images');
  if (tiny > 0) issues.push('tiny_images');
  if (missingAlt > 0) issues.push('missing_alt');
  if (duplicateUrls.length > 0) issues.push('duplicate_within_post');
  if (tokens.length > 0 && contextual === 0) issues.push('no_title_token_in_alt_or_caption');

  return {
    ...row,
    imageCount,
    titleTokens: tokens,
    missingAlt,
    broken,
    tiny,
    duplicateUrls: [...new Set(duplicateUrls)],
    contextualImages: contextual,
    failed: issues.length > 0,
    issues,
  };
}

async function main() {
  if (!baseUrl) throw new Error('--base is required');

  const links = await collectBlogLinks();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
  const rows = [];
  let cursor = 0;

  async function worker() {
    const page = await context.newPage();
    while (cursor < links.length) {
      const path = links[cursor];
      cursor += 1;
      try {
        const row = await auditPage(page, path);
        rows.push(judge(row));
      } catch (error) {
        rows.push({ path, error: error instanceof Error ? error.message : String(error), failed: true });
      }
    }
    await page.close();
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, links.length) }, () => worker()));
  await context.close();
  await browser.close();

  const summary = summarize(rows);
  const payload = {
    summary,
    failedExamples: rows.filter((row) => row.failed || row.error).slice(0, 20),
    rows,
  };

  if (outputJson) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`Blog image quality: ${summary.score}/100 (${summary.passed}/${summary.fetched} passed, errors=${summary.errors})`);
    console.log(`Images=${summary.totalImages}, unique=${summary.uniqueImages}, duplicateRatio=${summary.duplicateImageRatio}`);
    for (const row of payload.failedExamples) {
      console.log(`- ${row.path}: ${row.error || row.issues.join(', ')}`);
    }
  }

  if (summary.failed > 0 || summary.errors > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
