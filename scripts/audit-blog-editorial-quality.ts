#!/usr/bin/env tsx
import dotenv from 'dotenv';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { inspectBlogIntentQuality } from '../src/lib/blog-content-intent';
import { repairBlogEditorialQuality } from '../src/lib/blog-editorial-repair';

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ quiet: true });

type BlogListPost = {
  id?: string | null;
  slug?: string | null;
  seo_title?: string | null;
  angle_type?: string | null;
  category?: string | null;
  product_id?: string | null;
  status?: string | null;
  destination?: string | null;
  travel_packages?: { destination?: string | null } | Array<{ destination?: string | null }> | null;
};

type BlogDetailPost = BlogListPost & {
  blog_html?: string | null;
  seo_description?: string | null;
};

const args = process.argv.slice(2);
const argValue = (name: string, fallback: string | null = null) => {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};
const hasFlag = (name: string) => args.includes(name);

const baseUrl = (argValue('--base', process.env.BLOG_AUDIT_BASE_URL || 'https://www.yeosonam.com') || '').replace(/\/$/, '');
const limit = Number(argValue('--limit', '0')) || 0;
const source = argValue('--source', 'web') || 'web';
const strict = hasFlag('--strict');
const outputJson = hasFlag('--json');
const repairPreview = hasFlag('--repair-preview');
const concurrency = Math.max(1, Math.min(8, Number(argValue('--concurrency', '4')) || 4));
const timeoutMs = Math.max(1000, Number(argValue('--timeout-ms', process.env.BLOG_AUDIT_TIMEOUT_MS || '15000')) || 15000);
const requestedHardTimeoutMs = Number(argValue('--hard-timeout-ms', process.env.BLOG_AUDIT_HARD_TIMEOUT_MS || '0')) || 0;
const hardTimeoutMs = requestedHardTimeoutMs > 0 ? Math.max(timeoutMs + 1000, requestedHardTimeoutMs) : 0;

let hardTimer: NodeJS.Timeout | null = null;
if (hardTimeoutMs > 0) {
  hardTimer = setTimeout(() => {
    console.error(`[audit-blog-editorial] hard timeout after ${hardTimeoutMs}ms`);
    process.exit(124);
  }, hardTimeoutMs);
}

function destinationFrom(post: BlogListPost): string | null {
  if (post.destination) return post.destination;
  const packages = post.travel_packages;
  if (Array.isArray(packages)) return packages[0]?.destination ?? null;
  return packages?.destination ?? null;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: 'application/json',
      'user-agent': 'yeosonam-blog-editorial-audit/1.0',
    },
  });
  if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function getText(path: string): Promise<string> {
  const res = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'yeosonam-blog-editorial-audit/1.0',
    },
  });
  if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
  return res.text();
}

function textWithMarkdownLinks($: cheerio.CheerioAPI, element: Element): string {
  const clone = $(element).clone();
  clone.find('a[href]').each((_index, anchor) => {
    const label = $(anchor).text().replace(/\s+/g, ' ').trim();
    const href = ($(anchor).attr('href') || '').trim();
    if (!label || !href) return;
    $(anchor).replaceWith(`[${label}](${href})`);
  });
  return clone.text().replace(/\s+/g, ' ').trim();
}

async function fetchRenderedPostSource(post: BlogListPost): Promise<BlogDetailPost> {
  if (!post.slug) throw new Error('missing slug');
  const html = await getText(`/blog/${post.slug}`);
  const $ = cheerio.load(html);
  const article = $('article').first();
  const root = article.length ? article : $('main').first();
  const sourceParts: string[] = [];

  root.find('h1,h2,h3,p,li,table,blockquote,mark,aside').each((_index, element) => {
    const tag = element.tagName.toLowerCase();
    const text = textWithMarkdownLinks($, element);
    if (!text) return;
    if (tag === 'h1') sourceParts.push(`# ${text}`);
    else if (tag === 'h2') sourceParts.push(`## ${text}`);
    else if (tag === 'h3') sourceParts.push(`### ${text}`);
    else if (tag === 'li') sourceParts.push(`- ${text}`);
    else if (tag === 'blockquote') sourceParts.push(`> ${text}`);
    else if (tag === 'mark') sourceParts.push(`<mark>${text}</mark>`);
    else if (tag === 'aside') sourceParts.push(`<aside class="${$(element).attr('class') || ''}">${text}</aside>`);
    else if (tag === 'table') {
      $(element).find('tr').each((_rowIndex, row) => {
        const cells = $(row).find('th,td').map((_cellIndex, cell) => $(cell).text().replace(/\s+/g, ' ').trim()).get();
        if (cells.length > 0) sourceParts.push(`| ${cells.join(' | ')} |`);
      });
    } else {
      sourceParts.push(text);
    }
  });

  return {
    ...post,
    seo_title: $('h1').first().text().trim() || post.seo_title,
    blog_html: sourceParts.join('\n\n'),
  };
}

async function fetchDbPostById(post: BlogListPost): Promise<BlogDetailPost | null> {
  if (!post.id) return null;
  const { supabaseAdmin } = await import('../src/lib/supabase');
  const { data, error } = await supabaseAdmin
    .from('content_creatives')
    .select('id, slug, seo_title, seo_description, angle_type, category, content_type, product_id, status, destination, blog_html')
    .eq('id', post.id)
    .eq('status', 'published')
    .eq('channel', 'naver_blog')
    .maybeSingle();
  if (error || !data) return null;
  return data as BlogDetailPost;
}

async function collectPosts(): Promise<BlogListPost[]> {
  if (source === 'db') return collectDbPosts();

  const posts: BlogListPost[] = [];
  for (let page = 1; page <= 30; page += 1) {
    const json = await getJson<{ posts?: BlogListPost[]; totalPages?: number }>(`/api/blog?page=${page}&limit=50`);
    const batch = Array.isArray(json.posts) ? json.posts : [];
    posts.push(...batch.filter((post) => post.id && post.slug));
    if (limit > 0 && posts.length >= limit) return posts.slice(0, limit);
    if (batch.length === 0 || (json.totalPages && page >= json.totalPages)) break;
  }
  return limit > 0 ? posts.slice(0, limit) : posts;
}

async function collectDbPosts(): Promise<BlogDetailPost[]> {
  const { supabaseAdmin } = await import('../src/lib/supabase');
  const query = supabaseAdmin
    .from('content_creatives')
    .select('id, slug, seo_title, seo_description, angle_type, category, content_type, product_id, status, destination, blog_html, published_at')
    .eq('channel', 'naver_blog')
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  if (limit > 0) query.limit(limit);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as BlogDetailPost[];
}

async function mapLimit<T, R>(items: T[], worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await worker(items[index]);
      }
    }),
  );
  return results;
}

async function inspectPost(post: BlogListPost) {
  try {
    let row: BlogDetailPost | undefined;
    if (source === 'db') {
      row = post as BlogDetailPost;
    } else {
      try {
        const detail = await getJson<{ post?: BlogDetailPost }>(`/api/blog?id=${post.id}`);
        row = detail.post;
      } catch {
        row = await fetchRenderedPostSource(post);
      }
    }
    if (!row?.blog_html && post.slug) {
      row = await fetchRenderedPostSource(post);
    }
    if ((!row?.blog_html || row.blog_html.replace(/\s+/g, '').length < 80) && source !== 'db') {
      const dbRow = await fetchDbPostById(post);
      if (dbRow?.blog_html) row = dbRow;
    }

    if (row?.status && row.status !== 'published') {
      return {
        id: row.id ?? post.id,
        slug: row.slug ?? post.slug,
        title: row.seo_title ?? post.seo_title,
        passed: true,
        score: 100,
        intent: null,
        issues: [],
        skipped: true,
        skipReason: `status=${row.status}`,
      };
    }

    if (!row?.blog_html) {
      return {
        id: post.id,
        slug: post.slug,
        title: post.seo_title,
        passed: false,
        score: 0,
        intent: null,
        issues: [{ code: 'missing_body', severity: 'critical', message: 'blog_html is empty' }],
      };
    }

    const input = {
      title: row.seo_title ?? post.seo_title,
      slug: row.slug ?? post.slug,
      primaryKeyword: row.seo_title ?? post.seo_title ?? row.slug ?? post.slug,
      angleType: row.angle_type ?? post.angle_type,
      category: row.category ?? post.category,
      contentType: row.product_id ? 'package_intro' : 'guide',
      productId: row.product_id ?? post.product_id ?? null,
      blogHtml: row.blog_html,
    };
    const repair = repairPreview ? repairBlogEditorialQuality(input) : null;
    const report = repair?.after ?? inspectBlogIntentQuality(input);
    const passed = report.passed && report.issues.length === 0 && report.score === 100;

    return {
      id: row.id ?? post.id,
      slug: row.slug ?? post.slug,
      title: row.seo_title ?? post.seo_title,
      destination: destinationFrom(row) ?? destinationFrom(post),
      passed,
      score: report.score,
      intent: report.intent,
      issues: report.issues,
      repairPreview: repair ? {
        changed: repair.changed,
        changes: repair.changes,
        beforeScore: repair.before.score,
        afterScore: repair.after.score,
      } : undefined,
    };
  } catch (error) {
    return {
      id: post.id,
      slug: post.slug,
      title: post.seo_title,
      passed: false,
      score: 0,
      intent: null,
      issues: [{
        code: 'fetch_failed',
        severity: 'critical',
        message: error instanceof Error ? error.message : String(error),
      }],
    };
  }
}

function summarize(allRows: Awaited<ReturnType<typeof inspectPost>>[]) {
  const rows = allRows.filter((row) => !('skipped' in row && row.skipped));
  const issueCounts: Record<string, number> = {};
  const intentCounts: Record<string, number> = {};
  for (const row of rows) {
    if (row.intent) {
      const key = [
        row.intent.mode,
        row.intent.infoSubtype ?? row.intent.productSubtype ?? 'general',
      ].join(':');
      intentCounts[key] = (intentCounts[key] ?? 0) + 1;
    }
    for (const issue of row.issues) {
      issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1;
    }
  }

  const scores = rows.map((row) => row.score);
  const failed = rows.filter((row) => !row.passed);
  return {
    baseUrl,
    source,
    repairPreview,
    total: rows.length,
    skipped: allRows.length - rows.length,
    passed: rows.length - failed.length,
    failed: failed.length,
    score100: rows.length - failed.length,
    fleetScore: rows.length ? Math.floor(((rows.length - failed.length) / rows.length) * 100) : 0,
    averageScore: scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : 0,
    issueCounts,
    intentCounts,
    best: [...rows].sort((a, b) => b.score - a.score).slice(0, 10),
    worst: [...rows].sort((a, b) => a.score - b.score).slice(0, 20),
  };
}

async function main() {
  let posts: BlogListPost[];
  try {
    posts = await collectPosts();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const payload = {
      summary: {
        baseUrl,
        source,
        repairPreview,
        total: 0,
        skipped: 0,
        passed: 0,
        failed: 1,
        score100: 0,
        fleetScore: 0,
        averageScore: 0,
        issueCounts: { collect_posts_failed: 1 },
        intentCounts: {},
        best: [],
        worst: [],
      },
      rows: [{
        id: null,
        slug: null,
        title: null,
        passed: false,
        score: 0,
        intent: null,
        issues: [{ code: 'collect_posts_failed', severity: 'critical', message }],
      }],
    };
    if (outputJson) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`Blog editorial quality: 0/100 (collect failed: ${message})`);
    }
    if (strict) process.exitCode = 1;
    return;
  }
  if (posts.length === 0) {
    const payload = {
      summary: {
        baseUrl,
        source,
        repairPreview,
        total: 0,
        skipped: 0,
        passed: 0,
        failed: 1,
        score100: 0,
        fleetScore: 0,
        averageScore: 0,
        issueCounts: { no_posts_found: 1 },
        intentCounts: {},
        best: [],
        worst: [],
      },
      rows: [{
        id: null,
        slug: null,
        title: null,
        passed: false,
        score: 0,
        intent: null,
        issues: [{
          code: 'no_posts_found',
          severity: 'critical',
          message: 'no blog posts found from the selected source',
        }],
      }],
    };
    if (outputJson) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log('Blog editorial quality: 0/100 (no posts found)');
    }
    if (strict) process.exitCode = 1;
    return;
  }
  const rows = await mapLimit(posts, inspectPost);
  const summary = summarize(rows);

  if (outputJson) {
    console.log(JSON.stringify({ summary, rows }, null, 2));
  } else {
    console.log(`Blog editorial quality: ${summary.averageScore}/100 (${summary.passed}/${summary.total} passed, failed=${summary.failed})`);
    console.log(`Issue counts: ${JSON.stringify(summary.issueCounts)}`);
    console.log('Worst posts:');
    for (const row of summary.worst.slice(0, 10)) {
      const issueCodes = row.issues.map((issue) => issue.code).join(', ') || 'none';
      console.log(`- ${row.score}/100 ${row.slug}: ${issueCodes}`);
    }
  }

  if (strict && summary.failed > 0) process.exitCode = 1;
}

main()
  .then(() => {
    if (hardTimer) clearTimeout(hardTimer);
  })
  .catch((error) => {
    if (hardTimer) clearTimeout(hardTimer);
    console.error(error);
    process.exitCode = 1;
  });
