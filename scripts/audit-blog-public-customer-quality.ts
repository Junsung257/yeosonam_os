#!/usr/bin/env tsx

import * as cheerio from 'cheerio';
import type { Browser } from 'playwright';
import {
  inspectPublicBlogCustomerQuality,
  requiresHydratedPublicBlogAudit,
  type PublicBlogCustomerQualityReport,
} from '@/lib/blog-public-customer-quality';
import { resolvePublicBlogAuditCategory } from '@/lib/blog-public-audit-category';

const args = process.argv.slice(2);

function argValue(name: string, fallback: string | null = null): string | null {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

type BlogApiPost = {
  slug?: string | null;
  title?: string | null;
  seo_title?: string | null;
  destination?: string | null;
  category?: string | null;
  blog_type?: string | null;
  content_type?: string | null;
  product_id?: string | null;
};

interface PublicBlogTarget {
  path: string;
  slug: string;
  title?: string | null;
  destination?: string | null;
  category?: string | null;
  contentType?: string | null;
  expectedType?: 'info' | 'product' | 'unknown';
}

interface AuditedPublicBlogTarget extends PublicBlogTarget {
  url: string;
  ok: boolean;
  renderer?: 'html' | 'browser';
  status?: number;
  report?: PublicBlogCustomerQualityReport;
  error?: string;
}

const baseUrl = (argValue('--base', process.env.BLOG_AUDIT_BASE_URL || 'https://www.yeosonam.com') || '')
  .replace(/\/+$/, '');
const limit = Math.max(1, Number(argValue('--limit', '10')) || 10);
const timeoutMs = Math.max(3000, Number(argValue('--timeout-ms', '15000')) || 15000);
const concurrency = Math.max(1, Math.min(12, Number(argValue('--concurrency', '6')) || 6));
const retries = Math.max(0, Math.min(3, Number(argValue('--retries', '2')) || 0));
const strict = hasFlag('--strict');
const outputJson = hasFlag('--json');
const browserMode = hasFlag('--browser');
const htmlOnlyMode = hasFlag('--html-only');
const minScore = Math.max(0, Math.min(100, Number(argValue('--min-score', '95')) || 95));

function absolutize(path: string): string {
  return /^https?:\/\//i.test(path) ? path : `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
}

function slugToPath(slug: string): string {
  return `/blog/${slug.replace(/^\/?blog\//, '').replace(/^\/+/, '')}`;
}

function normalizeBlogPath(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    const url = /^https?:\/\//i.test(href) ? new URL(href) : new URL(href, baseUrl);
    if (url.origin !== new URL(baseUrl).origin) return null;
    const decodedPath = decodeURIComponent(url.pathname);
    if (!/^\/blog\/[^/]+/.test(decodedPath)) return null;
    if (/\/blog\/(?:angle|destination)\//.test(decodedPath)) return null;
    if (/\/opengraph-image(?:$|[/?#])/.test(decodedPath)) return null;
    return decodedPath.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function retryDelayMs(attempt: number): number {
  return Math.min(2_000, 250 * (2 ** attempt));
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function fetchText(url: string, accept = 'text/html,application/xhtml+xml'): Promise<{ status: number; text: string }> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          accept,
          'cache-control': 'no-cache',
          pragma: 'no-cache',
          'user-agent': 'yeosonam-public-customer-quality-audit/1.0',
        },
      });
      if (shouldRetryStatus(response.status) && attempt < retries) {
        await response.body?.cancel();
        await new Promise(resolve => setTimeout(resolve, retryDelayMs(attempt)));
        continue;
      }
      return { status: response.status, text: await response.text() };
    } catch (error) {
      lastError = error;
      if (attempt >= retries) throw error;
      await new Promise(resolve => setTimeout(resolve, retryDelayMs(attempt)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  workerCount: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(workerCount, Math.max(1, items.length)) },
      runWorker,
    ),
  );
  return results;
}

function inferExpectedType(post: BlogApiPost): 'info' | 'product' | 'unknown' {
  if (post.product_id) return 'product';
  const type = `${post.blog_type ?? ''} ${post.content_type ?? ''}`.toLowerCase();
  if (/product|package|commercial|sales/.test(type)) return 'product';
  if (/info|guide|editorial/.test(type)) return 'info';
  return 'unknown';
}

async function collectFromApi(): Promise<PublicBlogTarget[]> {
  try {
    const targets: PublicBlogTarget[] = [];
    const perPage = Math.min(50, Math.max(1, limit));
    const maxPages = Math.ceil(limit / perPage);
    for (let page = 1; page <= maxPages && targets.length < limit; page += 1) {
      const { status, text } = await fetchText(
        `${baseUrl}/api/blog?limit=${perPage}&page=${page}`,
        'application/json',
      );
      if (status < 200 || status >= 300) break;
      const payload = JSON.parse(text) as {
        posts?: BlogApiPost[];
        totalPages?: number;
      };
      const posts = Array.isArray(payload.posts) ? payload.posts : [];
      for (const post of posts) {
        const slug = post.slug?.trim();
        if (!slug) continue;
        targets.push({
          path: slugToPath(slug),
          slug,
          title: post.seo_title ?? post.title ?? null,
          destination: post.destination ?? null,
          category: post.category ?? null,
          contentType: post.content_type ?? null,
          expectedType: inferExpectedType(post),
        });
      }
      if (posts.length < perPage || page >= (payload.totalPages ?? page)) break;
    }
    return targets;
  } catch {
    return [];
  }
}

async function collectFromBlogList(): Promise<PublicBlogTarget[]> {
  try {
    const { status, text } = await fetchText(`${baseUrl}/blog`);
    if (status < 200 || status >= 300) return [];
    const $ = cheerio.load(text);
    const paths = new Set<string>();
    $('a[href]').each((_index, element) => {
      const path = normalizeBlogPath($(element).attr('href'));
      if (path) paths.add(path);
    });
    return [...paths].map((path) => ({
      path,
      slug: path.replace(/^\/blog\//, ''),
      expectedType: 'unknown',
    }));
  } catch {
    return [];
  }
}

async function collectFromSitemap(): Promise<PublicBlogTarget[]> {
  try {
    const { status, text } = await fetchText(`${baseUrl}/sitemap.xml`, 'application/xml,text/xml,text/plain');
    if (status < 200 || status >= 300) return [];
    const paths = new Set<string>();
    for (const match of text.matchAll(/<loc>(https?:\/\/[^<]+)<\/loc>/gi)) {
      const path = normalizeBlogPath(match[1]);
      if (path) paths.add(path);
    }
    return [...paths].map((path) => ({
      path,
      slug: path.replace(/^\/blog\//, ''),
      expectedType: 'unknown',
    }));
  } catch {
    return [];
  }
}

function mergeTargets(groups: PublicBlogTarget[][]): PublicBlogTarget[] {
  const byPath = new Map<string, PublicBlogTarget>();
  for (const group of groups) {
    for (const target of group) {
      const existing = byPath.get(target.path);
      byPath.set(target.path, {
        ...existing,
        ...target,
        expectedType: existing?.expectedType && existing.expectedType !== 'unknown'
          ? existing.expectedType
          : target.expectedType,
        title: existing?.title || target.title,
        destination: existing?.destination || target.destination,
        category: existing?.category || target.category,
        contentType: existing?.contentType || target.contentType,
      });
    }
  }
  return [...byPath.values()].slice(0, limit);
}

async function collectTargets(): Promise<PublicBlogTarget[]> {
  const explicitSlug = argValue('--slug', null);
  if (explicitSlug) {
    const slug = explicitSlug.replace(/^\/?blog\//, '').replace(/^\/+/, '').trim();
    return [{
      path: slugToPath(slug),
      slug,
      expectedType: (argValue('--type', 'unknown') as PublicBlogTarget['expectedType']) || 'unknown',
      destination: argValue('--destination', null),
    }];
  }

  const [api, list, sitemap] = await Promise.all([
    collectFromApi(),
    collectFromBlogList(),
    collectFromSitemap(),
  ]);
  return mergeTargets([api, list, sitemap]);
}

async function loadBrowserRenderedHtml(
  browser: Browser,
  url: string,
): Promise<{ status: number; text: string }> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const page = await browser.newPage({
      userAgent: 'yeosonam-public-customer-quality-audit/1.0',
    });
    page.setDefaultTimeout(timeoutMs);
    await page.route('**/*', async (route) => {
      const resourceType = route.request().resourceType();
      if (resourceType === 'image' || resourceType === 'media' || resourceType === 'font') {
        await route.abort();
        return;
      }
      await route.continue();
    });

    try {
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });
      await page.locator('.prose-blog').first().waitFor({
        state: 'attached',
        timeout: Math.min(timeoutMs, 8_000),
      }).catch(() => undefined);
      const result = {
        status: response?.status() ?? 0,
        text: await page.content(),
      };
      if (!shouldRetryStatus(result.status) || attempt >= retries) return result;
      lastError = new Error(`Transient HTTP ${result.status}`);
    } catch (error) {
      lastError = error;
      if (attempt >= retries) throw error;
    } finally {
      await page.close();
    }
    await new Promise(resolve => setTimeout(resolve, retryDelayMs(attempt)));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function auditTarget(
  target: PublicBlogTarget,
  browser: Browser | null,
): Promise<AuditedPublicBlogTarget> {
  const url = absolutize(target.path);
  try {
    let renderer: 'html' | 'browser' = 'html';
    let response = browserMode && browser
      ? await loadBrowserRenderedHtml(browser, url)
      : await fetchText(url);
    if (
      !browserMode
      && !htmlOnlyMode
      && browser
      && response.status >= 200
      && response.status < 300
      && requiresHydratedPublicBlogAudit(response.text)
    ) {
      response = await loadBrowserRenderedHtml(browser, url);
      renderer = 'browser';
    } else if (browserMode) {
      renderer = 'browser';
    }
    const { status, text } = response;
    if (status < 200 || status >= 300) {
      return { ...target, url, ok: false, renderer, status, error: `HTTP ${status}` };
    }
    const report = inspectPublicBlogCustomerQuality({
      html: text,
      url,
      path: target.path,
      title: target.title,
      expectedType: target.expectedType,
      expectedDestination: target.destination,
    });
    return {
      ...target,
      url,
      renderer,
      status,
      ok: report.passed && report.score >= minScore,
      report,
    };
  } catch (error) {
    return {
      ...target,
      url,
      ok: false,
      renderer: browserMode ? 'browser' : 'html',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  if (!baseUrl) {
    console.error('--base is required');
    process.exit(1);
  }

  const targets = await collectTargets();
  if (targets.length === 0) {
    const summary = {
      baseUrl,
      checked: 0,
      passed: 0,
      failed: 1,
      averageScore: 0,
      issueCounts: { no_public_blog_targets: 1 },
      rows: [],
    };
    if (outputJson) console.log(JSON.stringify(summary, null, 2));
    else {
      console.log('Blog public customer quality: 0/100 (no discoverable public blog posts)');
      console.log('Issues={"no_public_blog_targets":1}');
    }
    process.exitCode = 1;
    return;
  }
  if (!outputJson) {
    console.log(
      `Auditing ${targets.length} public blog page(s) with renderer=${browserMode ? 'browser' : htmlOnlyMode ? 'html' : 'hybrid'}, concurrency=${concurrency}, retries=${retries}`,
    );
  }
  const auditBrowser = !htmlOnlyMode
    ? await (await import('playwright')).chromium.launch({ headless: true })
    : null;
  let completed = 0;
  let rows: AuditedPublicBlogTarget[];
  try {
    rows = await mapWithConcurrency(
      targets,
      browserMode ? Math.min(concurrency, 6) : concurrency,
      async (target) => {
        const result = await auditTarget(target, auditBrowser);
        completed += 1;
        if (!outputJson && (completed % 25 === 0 || completed === targets.length)) {
          console.log(`Audited ${completed}/${targets.length}`);
        }
        return result;
      },
    );
  } finally {
    await auditBrowser?.close();
  }

  const failed = rows.filter((row) => !row.ok);
  const issueCounts = rows.reduce<Record<string, number>>((acc, row) => {
    for (const issue of row.report?.issues ?? []) {
      acc[issue.code] = (acc[issue.code] || 0) + 1;
    }
    if (row.error) acc.fetch_error = (acc.fetch_error || 0) + 1;
    return acc;
  }, {});
  const averageScore = rows.length > 0
    ? Math.round(rows.reduce((sum, row) => sum + (row.report?.score ?? 0), 0) / rows.length)
    : 0;
  const hydratedFallbackCount = rows.filter((row) => row.renderer === 'browser').length;
  const categoryScores = Object.values(rows.reduce<Record<string, {
    category: string;
    checked: number;
    passed: number;
    scores: number[];
    issueCounts: Record<string, number>;
  }>>((acc, row) => {
    const category = resolvePublicBlogAuditCategory({
      category: row.category,
      title: row.title,
      destination: row.destination,
      expectedType: row.expectedType,
      contentType: row.contentType,
    });
    const bucket = acc[category] ?? {
      category,
      checked: 0,
      passed: 0,
      scores: [],
      issueCounts: {},
    };
    bucket.checked += 1;
    if (row.ok) bucket.passed += 1;
    if (row.report) bucket.scores.push(row.report.score);
    for (const issue of row.report?.issues ?? []) {
      bucket.issueCounts[issue.code] = (bucket.issueCounts[issue.code] ?? 0) + 1;
    }
    acc[category] = bucket;
    return acc;
  }, {})).map((bucket) => {
    const minimumScore = bucket.scores.length > 0 ? Math.min(...bucket.scores) : 0;
    const averageCategoryScore = bucket.scores.length > 0
      ? Math.round(bucket.scores.reduce((sum, score) => sum + score, 0) / bucket.scores.length)
      : 0;
    return {
      category: bucket.category,
      checked: bucket.checked,
      passed: bucket.passed,
      passRate: Math.round((bucket.passed / Math.max(1, bucket.checked)) * 100),
      minimumScore,
      averageScore: averageCategoryScore,
      score: minimumScore,
      passed95:
        bucket.category !== 'unknown'
        && minimumScore >= 95
        && bucket.passed === bucket.checked,
      issueCounts: bucket.issueCounts,
    };
  }).sort((a, b) => a.category.localeCompare(b.category));
  const summary = {
    baseUrl,
    checked: rows.length,
    passed: rows.length - failed.length,
    failed: failed.length,
    averageScore,
    minScore,
    renderer: browserMode ? 'browser' : htmlOnlyMode ? 'html' : 'hybrid',
    hydratedFallbackCount,
    concurrency,
    retries,
    issueCounts,
    passed95CategoryCount: categoryScores.filter(category => category.passed95).length,
    failed95CategoryCount: categoryScores.filter(category => !category.passed95).length,
    categoryScores,
  };

  if (outputJson) {
    console.log(JSON.stringify({ summary, failedExamples: failed.slice(0, 10), rows }, null, 2));
  } else {
    console.log(`Blog public customer quality: ${averageScore}/100 (${summary.passed}/${summary.checked} passed)`);
    console.log(`Issues=${JSON.stringify(issueCounts)}`);
    for (const row of failed.slice(0, 10)) {
      const issues = row.report?.issues.map((issue) => `${issue.code}:${issue.severity}`).join(', ') || row.error;
      console.log(`- ${row.path} ${row.report?.score ?? 'ERR'}: ${issues}`);
    }
  }

  if (strict && (failed.length > 0 || categoryScores.some(category => !category.passed95))) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
