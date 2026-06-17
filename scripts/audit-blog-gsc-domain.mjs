#!/usr/bin/env node

import * as cheerio from 'cheerio';

const args = process.argv.slice(2);

function argValue(name, fallback = null) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

const preferredOrigin = (argValue('--preferred-origin', 'https://www.yeosonam.com') || '').replace(/\/$/, '');
const isLocalPreferredOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(preferredOrigin);
const samplePath = argValue('--path', '/blog/zhangjiajie-weather') || '/blog/zhangjiajie-weather';
const timeoutMs = Math.max(1000, Number(argValue('--timeout-ms', process.env.BLOG_AUDIT_TIMEOUT_MS || '15000')) || 15000);
const requestedHardTimeoutMs = Number(argValue('--hard-timeout-ms', process.env.BLOG_AUDIT_HARD_TIMEOUT_MS || '0')) || 0;
const hardTimeoutMs = requestedHardTimeoutMs > 0 ? Math.max(timeoutMs + 1000, requestedHardTimeoutMs) : 0;
const outputJson = hasFlag('--json');
const strict = hasFlag('--strict');

let hardTimer = null;
if (hardTimeoutMs > 0) {
  hardTimer = setTimeout(() => {
    console.error(`[audit-blog-gsc-domain] hard timeout after ${hardTimeoutMs}ms`);
    process.exit(124);
  }, hardTimeoutMs);
}

const ORIGIN_VARIANTS = isLocalPreferredOrigin ? [preferredOrigin] : [
  'http://yeosonam.com',
  'http://www.yeosonam.com',
  'https://yeosonam.com',
  'https://www.yeosonam.com',
];

async function fetchWithRedirects(url) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: 'text/html,application/xml,text/xml',
        'user-agent': 'yeosonam-blog-gsc-domain-audit/1.0',
      },
    });
    return {
      inputUrl: url,
      finalUrl: response.url,
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get('content-type') || '',
      text: await response.text().catch(() => ''),
    };
  } catch (error) {
    return {
      inputUrl: url,
      finalUrl: '',
      status: 0,
      ok: false,
      contentType: '',
      text: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}${parsed.search}`;
  } catch {
    return url;
  }
}

function expectedUrl(path) {
  return normalizeUrl(`${preferredOrigin}${path.startsWith('/') ? '' : '/'}${path}`);
}

function normalizeToPreferredOrigin(url) {
  try {
    const parsed = new URL(url, preferredOrigin);
    if (isLocalPreferredOrigin) {
      const preferred = new URL(preferredOrigin);
      parsed.protocol = preferred.protocol;
      parsed.host = preferred.host;
    }
    return normalizeUrl(parsed.toString());
  } catch {
    return normalizeUrl(url);
  }
}

async function auditRedirects() {
  const expected = expectedUrl(samplePath);
  return Promise.all(ORIGIN_VARIANTS.map(async (origin) => {
    const result = await fetchWithRedirects(`${origin}${samplePath}`);
    return {
      inputUrl: result.inputUrl,
      finalUrl: result.finalUrl,
      status: result.status,
      ok: result.ok,
      passed: result.ok && normalizeUrl(result.finalUrl) === expected,
    };
  }));
}

async function auditCanonical() {
  const result = await fetchWithRedirects(`${preferredOrigin}${samplePath}`);
  const $ = cheerio.load(result.text);
  const canonical = $('link[rel="canonical"]').attr('href') || '';
  const ogUrl = $('meta[property="og:url"]').attr('content') || '';
  const expected = expectedUrl(samplePath);
  return {
    url: `${preferredOrigin}${samplePath}`,
    finalUrl: result.finalUrl,
    status: result.status,
    canonical,
    ogUrl,
    expected,
    passed: result.ok && normalizeToPreferredOrigin(canonical) === expected && normalizeToPreferredOrigin(ogUrl) === expected,
  };
}

async function auditSitemap() {
  const result = await fetchWithRedirects(`${preferredOrigin}/sitemap.xml`);
  const sitemapText = result.text || '';
  const sitemapLocs = [...sitemapText.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => normalizeToPreferredOrigin(match[1].trim()));
  const hasPreferredOriginOnly = isLocalPreferredOrigin || (sitemapText.includes(preferredOrigin)
    && !sitemapText.includes('https://yeosonam.com/')
    && !sitemapText.includes('http://yeosonam.com/')
    && !sitemapText.includes('http://www.yeosonam.com/'));
  const hasSampleUrl = sitemapLocs.includes(expectedUrl(samplePath));
  return {
    url: `${preferredOrigin}/sitemap.xml`,
    finalUrl: result.finalUrl,
    status: result.status,
    contentType: result.contentType,
    hasPreferredOriginOnly,
    hasSampleUrl,
    passed: result.ok && hasPreferredOriginOnly && hasSampleUrl,
  };
}

function auditEnvHints() {
  const siteUrl = process.env.GSC_SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || '';
  const normalizedSiteUrl = siteUrl.replace(/\/$/, '');
  return {
    gscSiteUrl: siteUrl ? `${normalizedSiteUrl}/` : null,
    nextPublicBaseUrl: process.env.NEXT_PUBLIC_BASE_URL || null,
    preferredOrigin,
    passed: !siteUrl || normalizedSiteUrl === preferredOrigin,
    note: 'Domain property can coexist with URL-prefix properties; automation must still use the preferred www canonical property.',
  };
}

async function main() {
  const [redirects, canonical, sitemap] = await Promise.all([
    auditRedirects(),
    auditCanonical(),
    auditSitemap(),
  ]);
  const env = auditEnvHints();
  const issues = [];
  for (const redirect of redirects) {
    if (!redirect.passed) issues.push(`redirect:${redirect.inputUrl}`);
  }
  if (!canonical.passed) issues.push('canonical_or_og_url');
  if (!sitemap.passed) issues.push('sitemap_origin_or_sample_url');
  if (!env.passed) issues.push('gsc_site_url_env_mismatch');

  const output = {
    summary: {
      preferredOrigin,
      samplePath,
      score: issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 25),
      passed: issues.length === 0,
      issues,
    },
    redirects,
    canonical,
    sitemap,
    env,
  };

  if (outputJson) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`Blog GSC/domain audit: ${output.summary.score}/100`);
    if (issues.length) console.log(`Issues: ${issues.join(', ')}`);
    console.log(`Canonical: ${canonical.canonical}`);
    console.log(`Sitemap: ${sitemap.url} status=${sitemap.status}`);
  }

  if (strict && issues.length > 0) process.exitCode = 1;
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
