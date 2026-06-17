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
const concurrency = Math.max(1, Math.min(12, Number(getArg('--concurrency', '2')) || 2));
const timeoutMs = Math.max(1000, Number(getArg('--timeout-ms', '15000')) || 15000);
const requestedHardTimeoutMs = Number(getArg('--hard-timeout-ms', process.env.BLOG_AUDIT_HARD_TIMEOUT_MS || '0')) || 0;
const hardTimeoutMs = requestedHardTimeoutMs > 0 ? Math.max(timeoutMs + 1000, requestedHardTimeoutMs) : 0;
const outputJson = hasFlag('--json');

let hardTimer = null;
if (hardTimeoutMs > 0) {
  hardTimer = setTimeout(() => {
    console.error(`[audit-blog-images] hard timeout after ${hardTimeoutMs}ms`);
    process.exit(124);
  }, hardTimeoutMs);
}

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

const ADDITIONAL_STOP_WORDS = new Set([
  '2026',
  '예산',
  '경비',
  '비용',
  '체크',
  '현지팁',
  '준비물',
  '가이드',
  '여소남',
  'vs',
  'at',
  'cost',
  'saving',
  'family',
  'june',
]);

const TOKEN_ALIASES = new Map([
  ['danang', '다낭'],
  ['busan', '부산'],
  ['guam', '괌'],
  ['cebu', '세부'],
  ['bohol', '보홀'],
  ['travelwallet', '트래블월렛'],
]);

function normalizeToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{Script=Hangul}\p{Letter}\p{Number}]+/gu, '');
}

function isWeakContextToken(token) {
  const hasHangul = /\p{Script=Hangul}/u.test(token);
  const hasLatin = /[a-z]/i.test(token);
  const hasDigit = /\d/.test(token);

  if (!token || (token.length < 2 && !/^\p{Script=Hangul}$/u.test(token))) return true;
  if (STOP_WORDS.has(token) || ADDITIONAL_STOP_WORDS.has(token)) return true;
  if (hasHangul && hasDigit && token.length >= 8) return true;
  if (hasHangul && token.includes('여행') && token.length >= 8) return true;
  if (!hasHangul && hasLatin && hasDigit) return true;
  if (!hasHangul && /^(?:top|best|post|guide|travel|complete|weather|itinerary|shill)\d*$/i.test(token)) return true;
  if (hasHangul && token.length >= 14) return true;
  if (!hasHangul && token.length >= 14) return true;
  return false;
}

function titleTokens(title) {
  return [...new Set(String(title || '')
    .replace(/\|\s*여소남.*$/i, '')
    .split(/[^\p{Script=Hangul}\p{Letter}\p{Number}]+/gu)
    .map(normalizeToken)
    .filter((token) => !isWeakContextToken(token)))]
    .slice(0, 10);
}

async function fetchText(path) {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'user-agent': 'yeosonam-blog-image-audit/1.0',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) throw new Error(`${path} returned ${res.status}`);
    return res.text();
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new Error(`${path} timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
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
  const errors = [];
  let page = 1;

  while (page <= 20) {
    const path = page === 1 ? '/blog' : `/blog?page=${page}`;
    let html = '';
    try {
      html = await fetchText(path);
    } catch (error) {
      errors.push({
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      break;
    }
    const matches = html.matchAll(/href="(\/blog\/[^"#?]+)"/g);
    let before = links.size;
    for (const match of matches) {
      const href = match[1];
      if (!href) continue;
      if (href.startsWith('/blog/angle/') || href.startsWith('/blog/destination/')) continue;
      links.add(href);
    }
    if (limit > 0 && links.size >= limit) {
      const limited = [...links].slice(0, limit);
      limited.collectionErrors = errors;
      return limited;
    }
    if (links.size === before && page > 1) break;
    if (!html.includes(`page=${page + 1}`) && !html.includes(`>${page + 1}<`)) break;
    page += 1;
  }

  const result = [...links];
  const limited = limit > 0 ? result.slice(0, limit) : result;
  limited.collectionErrors = errors;
  return limited;
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
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.waitForSelector('article, body', { timeout: Math.min(timeoutMs, 5000) }).catch(() => undefined);
  await page.waitForSelector('article img', { timeout: Math.min(timeoutMs, 3000) }).catch(() => undefined);
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
        srcset: img.getAttribute('srcset') || '',
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

async function auditPageWithRetry(page, path) {
  let lastRow = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await auditPage(page, path);
    if (/\b5\d\d\b|GATEWAY_TIMEOUT|TIMEOUT/i.test(row.title || '')) return row;
    if (row.images.length > 0) return row;
    lastRow = { ...row, retryReason: 'no_article_images', attempts: attempt + 1 };
    await page.waitForTimeout(500 * (attempt + 1));
  }
  return lastRow;
}

function judge(row) {
  const tokens = [...new Set(titleTokens(row.title)
    .flatMap((token) => TOKEN_ALIASES.has(token) ? [token, TOKEN_ALIASES.get(token)] : [token]))];
  const seen = new Set();
  const duplicateUrls = [];
  let missingAlt = 0;
  let broken = 0;
  let tiny = 0;
  let contextual = 0;

  function maxSrcsetWidth(srcset) {
    return Math.max(
      0,
      ...String(srcset || '')
        .split(',')
        .map((candidate) => Number(candidate.trim().match(/\s(\d+)w(?:\s|$)/)?.[1] || 0)),
    );
  }

  for (const image of row.images) {
    if (image.reachable === false) broken += 1;
    const declaredMaxWidth = maxSrcsetWidth(image.srcset);
    if (declaredMaxWidth > 0 ? declaredMaxWidth < 320 : image.naturalWidth > 0 && image.naturalWidth < 320) tiny += 1;
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
  const collectionErrors = links.collectionErrors || [];
  const rows = [];
  let cursor = 0;

  if (links.length > 0) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 1600 } });

    async function worker() {
      const page = await context.newPage();
      while (cursor < links.length) {
        const path = links[cursor];
        cursor += 1;
        try {
          const row = await auditPageWithRetry(page, path);
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
  }
  for (const issue of collectionErrors) {
    rows.push({
      path: issue.path,
      error: issue.error,
      failed: true,
      collectionError: true,
    });
  }

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

main()
  .then(() => {
    if (hardTimer) clearTimeout(hardTimer);
    process.exit(process.exitCode ?? 0);
  })
  .catch((error) => {
    if (hardTimer) clearTimeout(hardTimer);
    console.error(error);
    process.exit(1);
  });
