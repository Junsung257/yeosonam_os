#!/usr/bin/env node

/**
 * Smoke-check customer-facing critical pages.
 *
 * Usage:
 *   node scripts/audit-public-critical-pages.mjs
 *   BASE_URL=https://www.yeosonam.com node scripts/audit-public-critical-pages.mjs
 *
 * The audit is intentionally read-only: it checks page availability, basic
 * information scent, CTA presence, and latency budgets without submitting forms.
 */

import * as cheerio from 'cheerio';

const args = process.argv.slice(2);
function argValue(name, fallback = '') {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
}
function hasFlag(name) {
  return args.includes(name);
}

const baseUrl = (argValue('--base', process.env.BASE_URL || 'http://localhost:3000') || '').replace(/\/$/, '');
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(baseUrl);
const timeoutMs = Math.max(1000, Number(argValue('--timeout-ms', process.env.PUBLIC_AUDIT_TIMEOUT_MS || '30000')) || 30000);
const outputJson = hasFlag('--json');
const requestedHardTimeoutMs = Number(argValue('--hard-timeout-ms', process.env.PUBLIC_AUDIT_HARD_TIMEOUT_MS || '0')) || 0;
const hardTimeoutMs = requestedHardTimeoutMs > 0
  ? Math.max(timeoutMs + 1000, requestedHardTimeoutMs)
  : Math.min(120000, timeoutMs * 8 + 15000);

const hardTimer = setTimeout(() => {
  console.error(`[public-critical-pages] hard timeout after ${hardTimeoutMs}ms`);
  process.exit(124);
}, hardTimeoutMs);
hardTimer.unref?.();
const explicitPackageId = argValue('--package-id', process.env.PUBLIC_AUDIT_PACKAGE_ID || process.env.OPEN_CHECK_PACKAGE_ID || '').trim();
const retries = Math.max(0, Number(argValue('--retries', process.env.PUBLIC_AUDIT_RETRIES || '1')) || 0);

const corePages = [
  {
    name: 'home',
    path: '/',
    budgetMs: 5000,
    mustHaveAny: ['여소남', '패키지', '여행'],
    ctaAny: ['상품', '상담', '문의', '여행'],
  },
  {
    name: 'packages',
    path: '/packages',
    budgetMs: 5000,
    mustHaveAny: ['상품', '패키지', '여행'],
    ctaAny: ['상세', '보기', '문의', '비교'],
  },
  {
    name: 'concierge',
    path: '/concierge',
    budgetMs: 5000,
    mustHaveAny: ['컨시어지', '상담', '여행'],
    ctaAny: ['상담', '문의', '시작', '검색', '열기'],
  },
  {
    name: 'group-inquiry',
    path: '/group-inquiry',
    budgetMs: 5000,
    mustHaveAny: ['단체', '문의', '여행'],
    ctaAny: ['문의', '상담', '제출', '전송', '견적', '등록'],
  },
  {
    name: 'blog',
    path: '/blog',
    budgetMs: 5000,
    mustHaveAny: ['블로그', '여행', '가이드'],
    ctaAny: ['상품', '상담', '자세히', '보기'],
  },
  {
    name: 'destinations',
    path: '/destinations',
    budgetMs: 10000,
    mustHaveAny: ['목적지', '여행', '지역'],
    ctaAny: ['상품', '보기', '여행', '상담'],
  },
];

function pathUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

async function fetchTextOnce(path) {
  const controller = new AbortController();
  const started = Date.now();
  let timer;
  const timeoutResult = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({
        ok: false,
        status: null,
        ms: Date.now() - started,
        contentType: '',
        location: '',
        text: '',
        error: `timeout after ${timeoutMs}ms`,
      });
    }, timeoutMs);
  });
  const request = (async () => {
    const res = await fetch(pathUrl(path), {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5',
        Connection: 'close',
      },
    });
    const text = await res.text();
    return {
      ok: true,
      status: res.status,
      ms: Date.now() - started,
      contentType: res.headers.get('content-type') || '',
      location: res.headers.get('location') || '',
      text,
    };
  })();

  try {
    return await Promise.race([request, timeoutResult]);
  } catch (err) {
    return {
      ok: false,
      status: null,
      ms: Date.now() - started,
      contentType: '',
      location: '',
      text: '',
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(path) {
  let lastResult = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const result = await fetchTextOnce(path);
    lastResult = { ...result, attempts: attempt + 1 };
    if (result.ok && result.status !== null && result.status < 500) return lastResult;
  }
  return lastResult;
}

function visibleText($) {
  $('script,style,noscript,svg').remove();
  return $('body').text().replace(/\s+/g, ' ').trim();
}

function hasAny(haystack, needles) {
  return needles.some((needle) => haystack.includes(needle));
}

function analyzeHtml(page, result) {
  const $ = cheerio.load(result.text);
  const h1 = $('h1').first().text().replace(/\s+/g, ' ').trim();
  const title = $('title').first().text().replace(/\s+/g, ' ').trim();
  const canonical = $('link[rel="canonical"]').attr('href') || '';
  const text = visibleText($);
  const ctaText = $('a,button')
    .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
    .get()
    .filter(Boolean)
    .join(' | ');

  const missing = [];
  if (!result.contentType.includes('text/html')) missing.push('html');
  if (!h1) missing.push('h1');
  if (page.mustHaveAny && !hasAny(`${h1} ${title} ${text}`, page.mustHaveAny)) missing.push('information-scent');
  if (page.ctaAny && !hasAny(ctaText, page.ctaAny)) missing.push('cta');
  if (result.status >= 300 && result.status < 400 && !result.location) missing.push('redirect-location');
  if (result.ms > page.budgetMs) missing.push('over-budget');

  return { h1, title, canonical, ctaCount: ctaText ? ctaText.split('|').length : 0, missing };
}

async function resolvePackageDetailPath() {
  if (explicitPackageId) return `/packages/${encodeURIComponent(explicitPackageId)}`;

  const api = await fetchText('/api/packages?status=active');
  if (api.status === 200 && api.contentType.includes('application/json')) {
    try {
      const json = JSON.parse(api.text);
      const pkg = json.packages?.find((p) => p?.id);
      if (pkg?.id) return `/packages/${pkg.id}`;
    } catch {
      // fall through to sitemap
    }
  }

  const sitemap = await fetchText('/sitemap.xml');
  const match = sitemap.text.match(/<loc>(https?:\/\/[^<]+\/packages\/[^<]+)<\/loc>/);
  if (match?.[1]) {
    const url = new URL(match[1]);
    return `${url.pathname}${url.search}`;
  }
  return null;
}

const pages = [...corePages];
const packageDetailPath = await resolvePackageDetailPath();
if (packageDetailPath) {
  pages.push({
    name: 'package-detail',
    path: packageDetailPath,
    budgetMs: 6000,
    mustHaveAny: ['일정', '가격', '포함', '취소', '여행'],
    ctaAny: ['문의', '상담', '예약', '찜', '공유'],
  });
}

if (isLocal) {
  for (const page of pages) {
    await fetchText(page.path).catch(() => null);
  }
}

const results = [];
for (const page of pages) {
  const result = await fetchText(page.path);
  const analysis = result.status === 200 && result.text ? analyzeHtml(page, result) : { missing: [] };
  const missing = [
    ...(result.ok ? [] : ['request']),
    ...(result.status === 200 ? [] : [`status:${result.status ?? 'ERR'}`]),
    ...analysis.missing,
  ];
  results.push({
    name: page.name,
    path: page.path,
    status: result.status,
    ms: result.ms,
    contentType: result.contentType,
    location: result.location,
    h1: analysis.h1 || '',
    ctaCount: analysis.ctaCount || 0,
    attempts: result.attempts || 1,
    missing,
    error: result.error || '',
  });
}

const failed = results.filter((row) => row.missing.length > 0);
const payload = {
  summary: {
    baseUrl,
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    skipped: packageDetailPath ? 0 : 1,
    score: results.length === 0 ? 0 : Math.round(((results.length - failed.length) / results.length) * 100),
    timeoutMs,
    retries,
  },
  warnings: packageDetailPath ? [] : [{ name: 'package-detail', reason: 'no active package URL resolved' }],
  results,
};

if (outputJson) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  for (const row of results) {
    const label = row.missing.length === 0 ? 'PASS' : 'FAIL';
    console.log(`${label}  ${row.name}  ${row.status ?? 'ERR'}  ${row.ms}ms  ${row.path}${row.missing.length ? `  missing=${row.missing.join(',')}` : ''}`);
  }

  for (const warning of payload.warnings) {
    console.log(`WARN  ${warning.name}  skipped  ${warning.reason}`);
  }
}

if (failed.length > 0) {
  if (!outputJson) console.error(`\n[public-critical-pages] ${failed.length}/${results.length} checks failed.`);
  process.exit(1);
}

if (!outputJson) console.log(`\n[public-critical-pages] ${results.length}/${results.length} checks passed.`);
