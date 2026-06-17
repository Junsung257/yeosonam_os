#!/usr/bin/env node

import { chromium } from 'playwright';

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};
const hasFlag = (name) => args.includes(name);

const baseUrl = (getArg('--base', process.env.BLOG_AUDIT_BASE_URL || 'https://www.yeosonam.com') || '').replace(/\/$/, '');
const expectedCanonicalOriginInput = (getArg('--canonical-origin', process.env.BLOG_CANONICAL_ORIGIN || 'https://www.yeosonam.com') || '').replace(/\/$/, '');
const limit = Number(getArg('--limit', '0')) || 0;
const concurrency = Math.max(1, Math.min(10, Number(getArg('--concurrency', '5')) || 5));
const timeoutMs = Math.max(1000, Number(getArg('--timeout-ms', process.env.BLOG_AUDIT_TIMEOUT_MS || '15000')) || 15000);
const requestedHardTimeoutMs = Number(getArg('--hard-timeout-ms', process.env.BLOG_AUDIT_HARD_TIMEOUT_MS || '0')) || 0;
const hardTimeoutMs = requestedHardTimeoutMs > 0 ? Math.max(timeoutMs + 1000, requestedHardTimeoutMs) : 0;
const outputJson = hasFlag('--json');
const strictWarnings = hasFlag('--strict-warnings');

let hardTimer = null;
if (hardTimeoutMs > 0) {
  hardTimer = setTimeout(() => {
    console.error(`[audit-blog-seo] hard timeout after ${hardTimeoutMs}ms`);
    process.exit(124);
  }, hardTimeoutMs);
}

const LONGTAIL_MODIFIERS = /20\d{2}|비용|가격|일정|코스|날씨|월별|준비물|체크|체크리스트|환전|입국|서류|항공권|숙소|맛집|추천|가이드|후기|예약|포함|주의/i;
const RAW_MARKDOWN_ARTIFACTS = /!\[[^\]]*]\(|\[[^\]]+]\((?:https?:\/\/|\/)|(^|\n)#{1,6}\s|\*\*[^*]+\*\*/m;
const AUTHORITY_HOST_HINTS = [
  '.go.kr',
  '.gov',
  'mofa.go.kr',
  '0404.go.kr',
  'visit',
  'tourism',
  'weather',
  'airport',
  'immigration',
  'embassy',
  'consulate',
  'iata.org',
  'iatatravelcentre.com',
  'who.int',
  'japan.travel',
  'travel-europe.europa.eu',
  'travel.state.gov',
  'cbp.dhs.gov',
];

async function fetchText(path) {
  const url = /^https?:\/\//i.test(path) ? path : `${baseUrl}${path}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'user-agent': 'yeosonam-blog-seo-audit/1.0',
      accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.text();
}

function addBlogLink(links, href) {
  if (!href || !/^\/blog\//.test(href)) return;
  if (href.startsWith('/blog/angle/') || href.startsWith('/blog/destination/')) return;
  if (/\/opengraph-image(?:$|[/?#])/.test(href)) return;
  links.add(href.split('#')[0]);
}

async function collectBlogLinksFromSitemap(links) {
  const xml = await fetchText(`${baseUrl}/sitemap.xml`);
  for (const match of xml.matchAll(/<loc>(https?:\/\/[^<]+)<\/loc>/gi)) {
    try {
      const url = new URL(match[1]);
      addBlogLink(links, url.pathname);
      if (limit > 0 && links.size >= limit) break;
    } catch {
      // Ignore malformed sitemap URLs.
    }
  }
}

async function collectBlogLinks() {
  const apiLinks = await collectBlogLinksFromApi().catch(() => []);
  if (apiLinks.length > 0) return limit > 0 ? apiLinks.slice(0, limit) : apiLinks;

  const links = new Set();
  let page = 1;

  while (page <= 20) {
    const path = page === 1 ? '/blog' : `/blog?page=${page}`;
    const html = await fetchText(path);
    const matches = html.matchAll(/href="(\/blog\/[^"#?]+)"/g);
    const before = links.size;
    for (const match of matches) {
      addBlogLink(links, match[1]);
    }
    if (limit > 0 && links.size >= limit) break;
    if (links.size === before && page > 1) break;
    if (!html.includes(`page=${page + 1}`) && !html.includes(`>${page + 1}<`)) break;
    page += 1;
  }

  if (links.size === 0) {
    await collectBlogLinksFromSitemap(links);
  }

  const result = [...links];
  return limit > 0 ? result.slice(0, limit) : result;
}

async function collectBlogLinksFromApi() {
  const links = [];
  let page = 1;
  while (page <= 20) {
    const res = await fetch(`${baseUrl}/api/blog?page=${page}&limit=50`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'yeosonam-blog-seo-audit/1.0' },
    });
    if (!res.ok) break;
    const json = await res.json();
    const posts = Array.isArray(json.posts) ? json.posts : [];
    for (const post of posts) {
      if (post?.slug) links.push(`/blog/${post.slug}`);
      if (limit > 0 && links.length >= limit) return links;
    }
    if (posts.length === 0 || (json.totalPages && page >= json.totalPages)) break;
    page += 1;
  }
  return [...new Set(links)];
}

function absolutize(path) {
  return `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
}

function safeDecodePath(path) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function jsonLdTypes(value) {
  const out = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const type = node['@type'];
    if (Array.isArray(type)) out.push(...type.map(String));
    else if (type) out.push(String(type));
    if (Array.isArray(node['@graph'])) node['@graph'].forEach(visit);
    if (Array.isArray(node.mainEntity)) node.mainEntity.forEach(visit);
  };
  visit(value);
  return out;
}

function hostMatchesAuthority(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return AUTHORITY_HOST_HINTS.some((hint) => host.includes(hint));
  } catch {
    return false;
  }
}

function judge(row) {
  const issues = [];
  const warnings = [];
  const expectedCanonicalPath = safeDecodePath(row.path).replace(/\/$/, '');
  const expectedCanonicalOrigin = new URL(expectedCanonicalOriginInput).origin;
  let canonicalPath = '';
  let canonicalOrigin = '';
  try {
    const canonicalUrl = new URL(row.canonical || '');
    canonicalPath = safeDecodePath(canonicalUrl.pathname).replace(/\/$/, '');
    canonicalOrigin = canonicalUrl.origin;
  } catch {
    canonicalPath = safeDecodePath(String(row.canonical || '')).replace(/\/$/, '');
  }
  const title = row.title || '';
  const description = row.description || '';
  const visibleTitle = `${title} ${row.h1Text || ''}`;

  if (!title || title.length < 20 || title.length > 70) issues.push('bad_title_length');
  else if (title.length < 25) warnings.push('short_title');
  if (!description || description.length < 50 || description.length > 180) issues.push('bad_meta_description_length');
  if (!canonicalPath || canonicalPath !== expectedCanonicalPath) issues.push('bad_canonical');
  if (!canonicalOrigin || !isAllowedCanonicalOrigin(canonicalOrigin, expectedCanonicalOrigin)) issues.push('bad_canonical_origin');
  if (row.robots && /noindex/i.test(row.robots)) issues.push('noindex_on_published_post');
  if (row.h1Count !== 1) issues.push('bad_h1_count');
  if (row.h2Count < 3) issues.push('not_enough_h2');
  if (row.articleTextLength < 1200) issues.push('thin_content');
  if (row.articleTextLength < 2500) warnings.push('below_info_blog_ideal_length');
  if (row.imageCount < 2) issues.push('not_enough_article_images');
  if (row.imagesMissingAlt > 0) issues.push('image_alt_missing');
  if (row.ogImageMissing) issues.push('missing_og_image');
  if (!row.hasBlogPostingJsonLd) issues.push('missing_blogposting_jsonld');
  if (!row.hasBreadcrumbJsonLd) issues.push('missing_breadcrumb_jsonld');
  if (row.internalLinkCount < 1) issues.push('missing_internal_link');
  if (row.externalAuthorityLinkCount < 1) warnings.push('missing_external_authority_link');
  if (!LONGTAIL_MODIFIERS.test(visibleTitle)) warnings.push('weak_longtail_modifier');
  if (RAW_MARKDOWN_ARTIFACTS.test(row.articleTextSample)) issues.push('raw_markdown_visible');
  if (row.strikethroughCount > 0) issues.push('visible_strikethrough_or_deletion');
  if (!row.viewportMeta) issues.push('missing_viewport_meta');
  if (!row.ogTitle || !row.ogDescription) issues.push('missing_og_title_description');
  if (!row.twitterCard) warnings.push('missing_twitter_card');

  const passed = issues.length === 0;
  return {
    ...row,
    issues,
    warnings,
    failed: !passed,
  };
}

function isLocalOrigin(origin) {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

function isAllowedCanonicalOrigin(origin, expectedOrigin) {
  if (origin === expectedOrigin) return true;
  return isLocalOrigin(origin) && isLocalOrigin(baseUrl);
}

async function auditPage(page, path) {
  await page.goto(absolutize(path), { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.waitForSelector('article, body', { timeout: Math.min(10000, timeoutMs) }).catch(() => undefined);
  await page.waitForSelector('article h1, h1', { timeout: Math.min(5000, timeoutMs) }).catch(() => undefined);
  await page.waitForSelector('script[type="application/ld+json"]', { timeout: Math.min(5000, timeoutMs) }).catch(() => undefined);
  await page.waitForTimeout(500);
  return page.evaluate((auditPath) => {
    const meta = (name) =>
      document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ||
      document.querySelector(`meta[property="${name}"]`)?.getAttribute('content') ||
      '';
    const article = document.querySelector('article') || document.body;
    const articleText = article.textContent || '';
    const links = [...article.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') || '');
    const images = [...article.querySelectorAll('img')].map((img) => ({
      src: img.currentSrc || img.src || '',
      alt: img.getAttribute('alt') || '',
    }));
    const jsonLdScripts = [...document.querySelectorAll('script[type="application/ld+json"]')]
      .map((script) => script.textContent || '')
      .filter(Boolean);
    const jsonLdTypes = [];
    for (const text of jsonLdScripts) {
      try {
        const parsed = JSON.parse(text);
        const collect = (node) => {
          if (!node || typeof node !== 'object') return;
          const type = node['@type'];
          if (Array.isArray(type)) jsonLdTypes.push(...type.map(String));
          else if (type) jsonLdTypes.push(String(type));
          if (Array.isArray(node['@graph'])) node['@graph'].forEach(collect);
          if (Array.isArray(node.mainEntity)) node.mainEntity.forEach(collect);
        };
        collect(parsed);
      } catch {
        jsonLdTypes.push('__INVALID_JSON_LD__');
      }
    }

    return {
      path: auditPath,
      title: document.title.trim(),
      description: meta('description').trim(),
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '',
      robots: meta('robots'),
      viewportMeta: Boolean(document.querySelector('meta[name="viewport"]')),
      ogTitle: meta('og:title'),
      ogDescription: meta('og:description'),
      ogImage: meta('og:image'),
      twitterCard: meta('twitter:card'),
      h1Count: document.querySelectorAll('h1').length,
      h1Text: document.querySelector('h1')?.textContent?.trim() || '',
      h2Count: article.querySelectorAll('h2').length,
      articleTextLength: articleText.replace(/\s+/g, ' ').trim().length,
      articleTextSample: articleText.slice(0, 4000),
      strikethroughCount: article.querySelectorAll('del, s, strike, [style*="line-through"], .line-through').length,
      imageCount: images.length,
      imagesMissingAlt: images.filter((image) => image.alt.trim().length < 3).length,
      ogImageMissing: !meta('og:image'),
      links,
      images,
      jsonLdTypes,
      hasBlogPostingJsonLd: jsonLdTypes.includes('BlogPosting') || jsonLdTypes.includes('Article'),
      hasBreadcrumbJsonLd: jsonLdTypes.includes('BreadcrumbList'),
    };
  }, path);
}

function shouldRetrySeoRow(row) {
  return !row.error && (
    row.h1Count !== 1 ||
    row.h2Count < 3 ||
    row.imageCount < 2 ||
    !row.hasBlogPostingJsonLd ||
    !row.hasBreadcrumbJsonLd
  );
}

async function auditPageWithRetry(page, path) {
  let lastRow = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await auditPage(page, path);
    if (!shouldRetrySeoRow(row)) return row;
    lastRow = { ...row, retryReason: 'incomplete_seo_dom', attempts: attempt + 1 };
    await page.waitForTimeout(800 * (attempt + 1));
  }
  return lastRow;
}

function addCrossPageIssues(rows) {
  const titleCounts = new Map();
  const descriptionCounts = new Map();
  for (const row of rows) {
    if (!row.title) continue;
    titleCounts.set(row.title, (titleCounts.get(row.title) || 0) + 1);
    if (row.description) descriptionCounts.set(row.description, (descriptionCounts.get(row.description) || 0) + 1);
  }
  return rows.map((row) => {
    const issues = [...(row.issues || [])];
    const warnings = [...(row.warnings || [])];
    if (row.title && titleCounts.get(row.title) > 1) issues.push('duplicate_title');
    if (row.description && descriptionCounts.get(row.description) > 1) warnings.push('duplicate_meta_description');
    return {
      ...row,
      issues,
      warnings,
      failed: issues.length > 0,
    };
  });
}

function summarize(rows) {
  const fetched = rows.filter((row) => !row.error);
  const failed = fetched.filter((row) => row.failed || (strictWarnings && row.warnings?.length));
  const warningCount = fetched.reduce((sum, row) => sum + (row.warnings?.length || 0), 0);
  return {
    baseUrl,
    totalLinks: rows.length,
    fetched: fetched.length,
    errors: rows.length - fetched.length,
    failed: failed.length,
    passed: fetched.length - failed.length,
    score: fetched.length === 0 ? 0 : Math.round(((fetched.length - failed.length) / fetched.length) * 100),
    strictWarnings,
    warningCount,
    avgTitleLength: Number((fetched.reduce((sum, row) => sum + (row.title?.length || 0), 0) / Math.max(1, fetched.length)).toFixed(1)),
    avgDescriptionLength: Number((fetched.reduce((sum, row) => sum + (row.description?.length || 0), 0) / Math.max(1, fetched.length)).toFixed(1)),
    avgTextLength: Math.round(fetched.reduce((sum, row) => sum + (row.articleTextLength || 0), 0) / Math.max(1, fetched.length)),
    avgH2: Number((fetched.reduce((sum, row) => sum + (row.h2Count || 0), 0) / Math.max(1, fetched.length)).toFixed(1)),
    avgImages: Number((fetched.reduce((sum, row) => sum + (row.imageCount || 0), 0) / Math.max(1, fetched.length)).toFixed(1)),
  };
}

async function main() {
  if (!baseUrl) throw new Error('--base is required');
  let links = [];
  try {
    links = await collectBlogLinks();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const payload = {
      summary: {
        baseUrl,
        totalLinks: 0,
        fetched: 0,
        errors: 1,
        failed: 1,
        passed: 0,
        score: 0,
        strictWarnings,
        warningCount: 0,
        avgTitleLength: 0,
        avgDescriptionLength: 0,
        avgTextLength: 0,
        avgH2: 0,
        avgImages: 0,
      },
      failedExamples: [{ path: '/blog', error: message, failed: true }],
      warningExamples: [],
      rows: [{ path: '/blog', error: message, failed: true }],
    };
    if (outputJson) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`Blog SEO quality: 0/100 (collect failed: ${message})`);
    }
    process.exitCode = 1;
    return;
  }
  if (links.length === 0) {
    const payload = {
      summary: {
        baseUrl,
        totalLinks: 0,
        fetched: 0,
        errors: 1,
        failed: 1,
        passed: 0,
        score: 0,
        strictWarnings,
        warningCount: 0,
        avgTitleLength: 0,
        avgDescriptionLength: 0,
        avgTextLength: 0,
        avgH2: 0,
        avgImages: 0,
      },
      failedExamples: [{ path: '/blog', error: 'no blog links found from listing pages, API, or sitemap', failed: true }],
      warningExamples: [],
      rows: [{ path: '/blog', error: 'no blog links found from listing pages, API, or sitemap', failed: true }],
    };
    if (outputJson) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log('Blog SEO quality: 0/100 (no blog links found from listing pages, API, or sitemap)');
    }
    process.exitCode = 1;
    return;
  }
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
        const row = await auditPageWithRetry(page, path);
        row.internalLinkCount = row.links.filter((href) => href.startsWith('/') || /yeosonam\.com/i.test(href)).length;
        row.externalAuthorityLinkCount = row.links.filter((href) => /^https?:\/\//i.test(href) && !/yeosonam\.com/i.test(href) && hostMatchesAuthority(href)).length;
        rows.push(judge(row));
      } catch (error) {
        rows.push({ path, error: error instanceof Error ? error.message : String(error), failed: true });
      }
    }
    await page.close();
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, links.length)) }, () => worker()));
  await context.close();
  await browser.close();

  const judgedRows = addCrossPageIssues(rows);
  const summary = summarize(judgedRows);
  const payload = {
    summary,
    failedExamples: judgedRows.filter((row) => row.failed || row.error).slice(0, 20),
    warningExamples: judgedRows.filter((row) => !row.failed && row.warnings?.length).slice(0, 20),
    rows: judgedRows,
  };

  if (outputJson) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`Blog SEO quality: ${summary.score}/100 (${summary.passed}/${summary.fetched} passed, errors=${summary.errors}, warnings=${summary.warningCount})`);
    console.log(`Avg title=${summary.avgTitleLength}, desc=${summary.avgDescriptionLength}, text=${summary.avgTextLength}, H2=${summary.avgH2}, images=${summary.avgImages}`);
    for (const row of payload.failedExamples) {
      console.log(`- ${row.path}: ${row.error || row.issues.join(', ')}`);
    }
    for (const row of payload.warningExamples.slice(0, 5)) {
      console.log(`  warning ${row.path}: ${row.warnings.join(', ')}`);
    }
  }

  if (summary.failed > 0 || summary.errors > 0 || (strictWarnings && summary.warningCount > 0)) process.exitCode = 1;
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
