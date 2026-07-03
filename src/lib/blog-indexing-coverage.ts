export type BlogIndexingCoveragePost = {
  id: string | null;
  slug: string | null;
  published_at?: string | null;
};

export type BlogIndexingCoverageJob = {
  content_creative_id?: string | null;
  slug?: string | null;
  url?: string | null;
  status?: string | null;
};

export type BlogIndexingCoverageSummary = {
  checked_count: number;
  covered_count: number;
  missing_count: number;
  missing_slugs: string[];
  coverage_rate: number | null;
};

function normalizeSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withoutBlogPrefix = trimmed.replace(/^https?:\/\/[^/]+\/blog\//i, '').replace(/^\/?blog\//i, '');
  const slug = withoutBlogPrefix.replace(/^\/+|\/+$/g, '').split(/[?#]/)[0]?.trim().toLowerCase();
  return slug || null;
}

export function summarizeBlogIndexingCoverage(input: {
  posts: BlogIndexingCoveragePost[];
  jobs: BlogIndexingCoverageJob[];
  limit?: number;
}): BlogIndexingCoverageSummary {
  const posts = input.posts
    .filter((post) => normalizeSlug(post.slug))
    .slice(0, Math.max(1, input.limit ?? input.posts.length));

  const jobCreativeIds = new Set<string>();
  const jobSlugs = new Set<string>();

  for (const job of input.jobs) {
    if (typeof job.content_creative_id === 'string' && job.content_creative_id.trim()) {
      jobCreativeIds.add(job.content_creative_id.trim());
    }
    const slug = normalizeSlug(job.slug) ?? normalizeSlug(job.url);
    if (slug) jobSlugs.add(slug);
  }

  const missingSlugs: string[] = [];
  for (const post of posts) {
    const postId = typeof post.id === 'string' ? post.id.trim() : '';
    const slug = normalizeSlug(post.slug);
    if (!slug) continue;
    const covered = (postId && jobCreativeIds.has(postId)) || jobSlugs.has(slug);
    if (!covered) missingSlugs.push(slug);
  }

  const checkedCount = posts.length;
  const missingCount = missingSlugs.length;
  const coveredCount = Math.max(0, checkedCount - missingCount);

  return {
    checked_count: checkedCount,
    covered_count: coveredCount,
    missing_count: missingCount,
    missing_slugs: missingSlugs.slice(0, 12),
    coverage_rate: checkedCount > 0 ? Math.round((coveredCount / checkedCount) * 1000) / 10 : null,
  };
}
