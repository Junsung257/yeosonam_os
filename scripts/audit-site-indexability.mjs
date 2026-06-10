#!/usr/bin/env node

const args = process.argv.slice(2);
const getArg = (name, fallback = '') => {
  const hit = args.find((arg) => arg === name || arg.startsWith(`${name}=`));
  if (!hit) return fallback;
  if (hit === name) return 'true';
  return hit.slice(name.length + 1);
};
const hasFlag = (name) => args.includes(name);

const baseUrl = (getArg('--base', process.env.SITE_AUDIT_BASE_URL || 'https://www.yeosonam.com') || '').replace(/\/$/, '');
const limit = Number(getArg('--limit', '0')) || 0;
const concurrency = Math.max(1, Math.min(12, Number(getArg('--concurrency', '8')) || 8));
const strict = hasFlag('--strict');
const outputJson = hasFlag('--json');

function extractLocs(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim()).filter(Boolean);
}

function parseRobotsDisallows(text) {
  return [...text.matchAll(/^Disallow:\s*(\S+)/gim)]
    .map((match) => match[1].trim())
    .filter((rule) => rule && rule !== '/');
}

function isBlockedByRobots(url, disallows) {
  try {
    const pathname = new URL(url).pathname;
    return disallows.some((rule) => pathname.startsWith(rule));
  } catch {
    return false;
  }
}

function normalizeForCompare(url) {
  try {
    const parsed = new URL(url, baseUrl);
    parsed.hash = '';
    if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function textContent(html, pattern) {
  return (html.match(pattern)?.[1] || '').replace(/\s+/g, ' ').trim();
}

async function fetchText(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      'user-agent': 'YeosonamIndexabilityAudit/1.0',
      ...(init.headers || {}),
    },
  });
  const text = await res.text().catch(() => '');
  return { res, text };
}

async function auditUrl(url, disallows) {
  const row = {
    url,
    status: 0,
    location: '',
    robotsBlocked: isBlockedByRobots(url, disallows),
    robotsMeta: '',
    title: '',
    canonical: '',
    issues: [],
  };

  try {
    const { res, text } = await fetchText(url, { redirect: 'manual' });
    row.status = res.status;
    row.location = res.headers.get('location') || '';
    row.title = textContent(text, /<title[^>]*>([\s\S]*?)<\/title>/i);
    row.robotsMeta = textContent(text, /<meta\s+name=["']robots["']\s+content=["']([^"']+)/i);
    row.canonical = textContent(text, /<link\s+rel=["']canonical["']\s+href=["']([^"']+)/i);
  } catch (error) {
    row.status = 0;
    row.error = error instanceof Error ? error.message : String(error);
  }

  if (row.robotsBlocked) row.issues.push('robots_blocked_sitemap_url');
  if (row.status === 0 || row.status >= 400) row.issues.push('http_error_sitemap_url');
  if (row.status >= 300 && row.status < 400) row.issues.push('redirect_sitemap_url');
  if (/noindex/i.test(row.robotsMeta)) row.issues.push('noindex_sitemap_url');
  if (!row.title && row.status === 200) row.issues.push('missing_title');
  if (!row.canonical && row.status === 200 && !/noindex/i.test(row.robotsMeta)) row.issues.push('missing_canonical');
  if (
    row.canonical &&
    row.status === 200 &&
    !/noindex/i.test(row.robotsMeta) &&
    normalizeForCompare(row.canonical) !== normalizeForCompare(row.url)
  ) {
    row.issues.push('canonical_mismatch_sitemap_url');
  }

  return row;
}

async function main() {
  const sitemapUrl = `${baseUrl}/sitemap.xml`;
  const robotsUrl = `${baseUrl}/robots.txt`;
  const [{ text: sitemapXml }, { text: robotsText }] = await Promise.all([
    fetchText(sitemapUrl),
    fetchText(robotsUrl),
  ]);

  const disallows = parseRobotsDisallows(robotsText);
  const urls = extractLocs(sitemapXml).slice(0, limit > 0 ? limit : undefined);
  const rows = [];
  let cursor = 0;

  async function worker() {
    while (cursor < urls.length) {
      const url = urls[cursor];
      cursor += 1;
      rows.push(await auditUrl(url, disallows));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, urls.length)) }, () => worker()));

  const titleCounts = new Map();
  for (const row of rows) {
    const indexable = row.status === 200 && !row.robotsBlocked && !/noindex/i.test(row.robotsMeta) && !row.issues.includes('canonical_mismatch_sitemap_url');
    if (!indexable || !row.title) continue;
    titleCounts.set(row.title, (titleCounts.get(row.title) || 0) + 1);
  }
  for (const row of rows) {
    if (row.title && (titleCounts.get(row.title) || 0) > 1) row.issues.push('duplicate_title');
  }

  const issueCounts = rows.reduce((acc, row) => {
    for (const issue of row.issues) acc[issue] = (acc[issue] || 0) + 1;
    return acc;
  }, {});
  const failedRows = rows.filter((row) => row.issues.length > 0);
  const summary = {
    baseUrl,
    sitemapUrl,
    scanned: rows.length,
    passed: rows.length - failedRows.length,
    failed: failedRows.length,
    score: rows.length === 0 ? 0 : Math.round(((rows.length - failedRows.length) / rows.length) * 100),
    issueCounts,
  };

  if (outputJson) {
    console.log(JSON.stringify({ summary, failedExamples: failedRows.slice(0, 50), rows }, null, 2));
  } else {
    console.log(`Site indexability: ${summary.score}/100 (${summary.passed}/${summary.scanned} passed)`);
    console.log(`Issues=${JSON.stringify(issueCounts)}`);
    for (const row of failedRows.slice(0, 20)) {
      console.log(`- ${row.issues.join(',')} ${row.status} ${row.url}`);
    }
  }

  if (strict && failedRows.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
