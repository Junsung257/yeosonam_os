#!/usr/bin/env tsx

import './load-script-env';

import { blogIndexingUrlForSlug } from '../src/lib/blog-canonical-url';
import {
  findMissingBlogIndexingCoveragePosts,
  summarizeBlogIndexingCoverage,
  type BlogIndexingCoverageJob,
  type BlogIndexingCoveragePost,
} from '../src/lib/blog-indexing-coverage';

type BackfillResult = {
  content_creative_id: string | null;
  slug: string;
  url: string;
  action: 'would_enqueue' | 'enqueued' | 'deduped' | 'failed';
  job_id?: string;
  error?: string;
};

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

function numberArg(name: string, fallback: number, max: number): number {
  const parsed = Number(argValue(name));
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), max) : fallback;
}

function parseSlugFilter(): string[] {
  const raw = argValue('--slugs') ?? argValue('--slug') ?? '';
  return raw
    .split(',')
    .map((slug) => slug.trim().replace(/^\/?blog\//i, '').replace(/^\/+|\/+$/g, '').toLowerCase())
    .filter(Boolean);
}

async function loadPublishedPosts(limit: number, slugs: string[]): Promise<BlogIndexingCoveragePost[]> {
  const { supabaseAdmin } = await import('../src/lib/supabase');
  let query = supabaseAdmin
    .from('content_creatives')
    .select('id, slug, published_at')
    .eq('channel', 'naver_blog')
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  if (slugs.length > 0) {
    query = query.in('slug', slugs);
  } else {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as BlogIndexingCoveragePost[];
}

async function loadRecentIndexingJobs(): Promise<BlogIndexingCoverageJob[]> {
  const { supabaseAdmin } = await import('../src/lib/supabase');
  const { data, error } = await supabaseAdmin
    .from('blog_indexing_jobs')
    .select('content_creative_id, slug, url, status')
    .order('updated_at', { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []) as BlogIndexingCoverageJob[];
}

async function main() {
  const write = hasFlag('--write');
  const json = hasFlag('--json');
  const limit = numberArg('--limit', 50, 500);
  const slugs = parseSlugFilter();
  const posts = await loadPublishedPosts(limit, slugs);
  const jobsBefore = await loadRecentIndexingJobs();
  const missingPosts = findMissingBlogIndexingCoveragePosts({
    posts,
    jobs: jobsBefore,
    limit: slugs.length > 0 ? posts.length : limit,
  });
  const foundSlugs = new Set(posts.map((post) => String(post.slug ?? '').toLowerCase()).filter(Boolean));
  const notFoundSlugs = slugs.filter((slug) => !foundSlugs.has(slug));
  const results: BackfillResult[] = [];

  if (write && missingPosts.length > 0) {
    const { enqueueBlogIndexingJob } = await import('../src/lib/blog-indexing-outbox');
    for (const post of missingPosts) {
      const url = blogIndexingUrlForSlug(post.slug);
      const result = await enqueueBlogIndexingJob({
        slug: post.slug,
        url,
        contentCreativeId: post.id,
        source: 'indexing_outbox_backfill',
      });
      results.push({
        content_creative_id: post.id,
        slug: post.slug,
        url,
        action: result.ok ? (result.deduped ? 'deduped' : 'enqueued') : 'failed',
        job_id: result.jobId,
        error: result.error,
      });
    }
  } else {
    for (const post of missingPosts) {
      results.push({
        content_creative_id: post.id,
        slug: post.slug,
        url: blogIndexingUrlForSlug(post.slug),
        action: 'would_enqueue',
      });
    }
  }

  const jobsAfter = write ? await loadRecentIndexingJobs() : jobsBefore;
  const report = {
    mode: write ? 'write' : 'dry-run',
    checked_at: new Date().toISOString(),
    requested_slugs: slugs,
    not_found_slugs: notFoundSlugs,
    checked_posts: posts.length,
    before: summarizeBlogIndexingCoverage({
      posts,
      jobs: jobsBefore,
      limit: slugs.length > 0 ? posts.length : limit,
    }),
    after: summarizeBlogIndexingCoverage({
      posts,
      jobs: jobsAfter,
      limit: slugs.length > 0 ? posts.length : limit,
    }),
    enqueued: results.filter((result) => result.action === 'enqueued' || result.action === 'deduped').length,
    failed: results.filter((result) => result.action === 'failed').length,
    write_recommended: !write && missingPosts.length > 0,
    results,
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `[blog-indexing-outbox-backfill] mode=${report.mode} checked=${report.checked_posts} missing=${report.before.missing_count} enqueued=${report.enqueued} failed=${report.failed}`,
    );
    if (report.not_found_slugs.length > 0) {
      console.log(`not_found=${report.not_found_slugs.join(',')}`);
    }
    for (const result of results) {
      console.log(`- ${result.action} ${result.slug}${result.error ? `: ${result.error}` : ''}`);
    }
  }

  if (report.failed > 0 || report.not_found_slugs.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[blog-indexing-outbox-backfill] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
