#!/usr/bin/env tsx

import { checkPublicBlogSurfaces } from '@/lib/blog-public-surface-check';

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
  destination?: string | null;
};

const baseUrl = (argValue('--base', process.env.BLOG_AUDIT_BASE_URL || 'https://www.yeosonam.com') || '')
  .replace(/\/+$/, '');
const outputJson = hasFlag('--json');
const strict = hasFlag('--strict');
const includeDiagnostics = !hasFlag('--no-diagnostics');

async function fetchApiSamples(): Promise<{ slug: string | null; destination: string | null }> {
  try {
    const response = await fetch(`${baseUrl}/api/blog?limit=5`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return { slug: null, destination: null };
    const payload = await response.json() as { posts?: BlogApiPost[] };
    const posts = Array.isArray(payload.posts) ? payload.posts : [];
    const slug = posts.find((post) => typeof post.slug === 'string' && post.slug.trim())?.slug?.trim() || null;
    const destination = posts
      .map((post) => post.destination)
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
      ?.trim() || null;
    return { slug, destination };
  } catch {
    return { slug: null, destination: null };
  }
}

async function main() {
  if (!baseUrl) {
    console.error('--base is required');
    process.exit(1);
  }

  const explicitSlug = argValue('--slug', null);
  const explicitDestination = argValue('--destination', null);
  const sampled = explicitSlug && explicitDestination
    ? { slug: explicitSlug, destination: explicitDestination }
    : await fetchApiSamples();
  const slug = explicitSlug || sampled.slug;
  const destination = explicitDestination || sampled.destination;

  const report = await checkPublicBlogSurfaces({
    baseUrl,
    slug,
    destination,
    includeDiagnostics,
  });
  const score = report.checked > 0 ? Math.round(((report.checked - report.failed) / report.checked) * 100) : 0;
  const summary = {
    baseUrl,
    score,
    checked: report.checked,
    failed: report.failed,
    warn: report.warn,
    sampled_slug: slug,
    sampled_destination: destination,
    issueCounts: report.results.reduce<Record<string, number>>((acc, result) => {
      for (const issue of result.issues) acc[issue] = (acc[issue] || 0) + 1;
      return acc;
    }, {}),
  };
  const failedExamples = report.results.filter((result) => !result.ok).slice(0, 20);

  if (outputJson) {
    console.log(JSON.stringify({ summary, failedExamples, rows: report.results }, null, 2));
  } else {
    console.log(`Blog public surfaces: ${summary.score}/100 (${summary.checked - summary.failed}/${summary.checked} passed)`);
    console.log(`Samples: slug=${slug || 'none'} destination=${destination || 'none'}`);
    console.log(`Issues=${JSON.stringify(summary.issueCounts)}`);
    for (const row of failedExamples) {
      console.log(`- ${row.id} ${row.status ?? 'ERR'} ${row.path}: ${row.issues.join(', ')}`);
    }
  }

  if (strict && report.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
