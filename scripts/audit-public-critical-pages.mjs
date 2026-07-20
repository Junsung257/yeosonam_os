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
  const message = `[public-critical-pages] hard timeout after ${hardTimeoutMs}ms`;
  if (outputJson) {
    console.log(JSON.stringify({
      summary: {
        baseUrl,
        failed: 1,
        failureTypes: { 'audit-hard-timeout': 1 },
        serverReachability: {
          ok: false,
          type: 'audit-hard-timeout',
          action: 'Check whether the target server is reachable and consider increasing --hard-timeout-ms for slow local builds.',
        },
      },
      warnings: [],
      results: [],
      error: message,
    }, null, 2));
  } else {
    console.error(message);
  }
  process.exit(124);
}, hardTimeoutMs);
hardTimer.unref?.();
const explicitPackageId = argValue('--package-id', process.env.PUBLIC_AUDIT_PACKAGE_ID || process.env.OPEN_CHECK_PACKAGE_ID || '').trim();
const retries = Math.max(0, Number(argValue('--retries', process.env.PUBLIC_AUDIT_RETRIES || '1')) || 0);

function errorCodeFrom(err) {
  let current = err;
  while (current && typeof current === 'object') {
    if (typeof current.code === 'string') return current.code;
    current = current.cause;
  }
  return '';
}

function classifyRequestFailure(result) {
  if (result.ok) return null;
  const code = result.errorCode || '';
  const message = result.error || '';

  if (result.timedOut || code === 'ABORT_TIMEOUT' || /timeout/i.test(message)) {
    return {
      type: 'request-timeout',
      category: 'request',
      action: `The request timed out after ${timeoutMs}ms. Confirm the local server finished booting or rerun with --timeout-ms=<larger value>.`,
    };
  }

  if (code === 'ECONNREFUSED') {
    return {
      type: 'connection-refused',
      category: 'request',
      action: `No server accepted connections at ${baseUrl}. Start the local app for that port, or pass the correct --base URL.`,
    };
  }

  if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) {
    return {
      type: 'connection-timeout',
      category: 'request',
      action: `The network connection to ${baseUrl} timed out. Check the host, port, firewall/VPN, and whether the server is still starting.`,
    };
  }

  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return {
      type: 'dns-failure',
      category: 'request',
      action: `The host in ${baseUrl} could not be resolved. Check the --base URL.`,
    };
  }

  return {
    type: 'request-error',
    category: 'request',
    action: `The page request failed before content checks ran. Check that ${baseUrl} is reachable and retry.`,
  };
}

function classifyPageFailure(result, analysis) {
  const requestFailure = classifyRequestFailure(result);
  if (requestFailure) return requestFailure;

  if (result.status !== 200) {
    return {
      type: 'http-status',
      category: 'status',
      action: `The server responded with HTTP ${result.status ?? 'ERR'}. Check the route, redirect/auth behavior, or server logs for this path.`,
    };
  }

  const analysisMissing = analysis.missing || [];
  const hasOnlyLatencyFailure = analysisMissing.length > 0
    && analysisMissing.every((item) => item === 'over-budget');

  if (hasOnlyLatencyFailure) {
    return {
      type: 'latency-budget',
      category: 'performance',
      action: 'The page loaded, but exceeded its latency budget. Check local build/server load before treating this as a content regression.',
    };
  }

  if (analysisMissing.length > 0) {
    return {
      type: 'page-content',
      category: 'content',
      action: `The page loaded, but failed content checks: ${analysisMissing.join(', ')}.`,
    };
  }

  return {
    type: 'none',
    category: 'none',
    action: '',
  };
}

function countByFailureType(rows) {
  return rows.reduce((acc, row) => {
    if (row.failureType && row.failureType !== 'none') {
      acc[row.failureType] = (acc[row.failureType] || 0) + 1;
    }
    return acc;
  }, {});
}

function summarizeReachability(rows) {
  if (rows.length === 0) {
    return { ok: false, type: 'not-checked', action: 'No pages were checked.' };
  }

  const requestFailures = rows.filter((row) => row.failureCategory === 'request');
  if (requestFailures.length === rows.length) {
    const type = requestFailures[0]?.failureType || 'request-error';
    const sameType = requestFailures.every((row) => row.failureType === type);
    return {
      ok: false,
      type: sameType ? type : 'request-error',
      action: sameType
        ? requestFailures[0].action
        : `Every page request failed before content checks ran. Check that ${baseUrl} is reachable and retry.`,
    };
  }

  if (requestFailures.length > 0) {
    return {
      ok: false,
      type: 'partial-request-failure',
      action: `${requestFailures.length} page request(s) failed before content checks ran. Check those paths and the local server logs.`,
    };
  }

  return {
    ok: true,
    type: 'reachable',
    action: '',
  };
}

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
    budgetMs: 20000,
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
        errorCode: 'ABORT_TIMEOUT',
        timedOut: true,
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
      errorCode: errorCodeFrom(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(path, budgetMs = null) {
  let lastResult = null;
  let bestOkResult = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const result = await fetchTextOnce(path);
    lastResult = { ...result, attempts: attempt + 1 };
    if (result.ok && result.status !== null && result.status < 500) {
      if (!bestOkResult || result.ms < bestOkResult.ms) {
        bestOkResult = lastResult;
      }
      if (!budgetMs || result.ms <= budgetMs) return lastResult;
    }
  }
  return bestOkResult || lastResult;
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
      const rows = Array.isArray(json.packages)
        ? json.packages
        : Array.isArray(json.data)
          ? json.data
          : [];
      const pkg = rows.find((p) => p?.id);
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
    budgetMs: 20000,
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
  const result = await fetchText(page.path, page.budgetMs);
  const analysis = result.status === 200 && result.text ? analyzeHtml(page, result) : { missing: [] };
  const failure = classifyPageFailure(result, analysis);
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
    errorCode: result.errorCode || '',
    failureType: missing.length > 0 ? failure.type : 'none',
    failureCategory: missing.length > 0 ? failure.category : 'none',
    action: missing.length > 0 ? failure.action : '',
  });
}

const failed = results.filter((row) => row.missing.length > 0);
const failureTypes = countByFailureType(results);
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
    failureTypes,
    serverReachability: summarizeReachability(results),
  },
  warnings: packageDetailPath ? [] : [{ name: 'package-detail', reason: 'no active package URL resolved' }],
  results,
};

if (outputJson) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  for (const row of results) {
    const label = row.missing.length === 0 ? 'PASS' : 'FAIL';
    const failureDetail = row.failureType && row.failureType !== 'none' ? `  type=${row.failureType}` : '';
    console.log(`${label}  ${row.name}  ${row.status ?? 'ERR'}  ${row.ms}ms  ${row.path}${row.missing.length ? `  missing=${row.missing.join(',')}` : ''}${failureDetail}`);
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
