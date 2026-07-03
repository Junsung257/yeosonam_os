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

export type BlogIndexingCoverageMissingPost = {
  id: string | null;
  slug: string;
  published_at?: string | null;
};

export function normalizeBlogIndexingSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withoutBlogPrefix = trimmed.replace(/^https?:\/\/[^/]+\/blog\//i, '').replace(/^\/?blog\//i, '');
  const slug = withoutBlogPrefix.replace(/^\/+|\/+$/g, '').split(/[?#]/)[0]?.trim().toLowerCase();
  return slug || null;
}

function buildJobCoverageSets(jobs: BlogIndexingCoverageJob[]): {
  jobCreativeIds: Set<string>;
  jobSlugs: Set<string>;
} {
  const jobCreativeIds = new Set<string>();
  const jobSlugs = new Set<string>();

  for (const job of jobs) {
    if (typeof job.content_creative_id === 'string' && job.content_creative_id.trim()) {
      jobCreativeIds.add(job.content_creative_id.trim());
    }
    const slug = normalizeBlogIndexingSlug(job.slug) ?? normalizeBlogIndexingSlug(job.url);
    if (slug) jobSlugs.add(slug);
  }

  return { jobCreativeIds, jobSlugs };
}

export function findMissingBlogIndexingCoveragePosts(input: {
  posts: BlogIndexingCoveragePost[];
  jobs: BlogIndexingCoverageJob[];
  limit?: number;
}): BlogIndexingCoverageMissingPost[] {
  const posts = input.posts
    .filter((post) => normalizeBlogIndexingSlug(post.slug))
    .slice(0, Math.max(1, input.limit ?? input.posts.length));

  const { jobCreativeIds, jobSlugs } = buildJobCoverageSets(input.jobs);

  const missingPosts: BlogIndexingCoverageMissingPost[] = [];
  for (const post of posts) {
    const postId = typeof post.id === 'string' ? post.id.trim() : '';
    const slug = normalizeBlogIndexingSlug(post.slug);
    if (!slug) continue;
    const covered = (postId && jobCreativeIds.has(postId)) || jobSlugs.has(slug);
    if (!covered) {
      missingPosts.push({
        id: post.id,
        slug,
        published_at: post.published_at ?? null,
      });
    }
  }

  return missingPosts;
}

export function summarizeBlogIndexingCoverage(input: {
  posts: BlogIndexingCoveragePost[];
  jobs: BlogIndexingCoverageJob[];
  limit?: number;
}): BlogIndexingCoverageSummary {
  const posts = input.posts
    .filter((post) => normalizeBlogIndexingSlug(post.slug))
    .slice(0, Math.max(1, input.limit ?? input.posts.length));
  const missingPosts = findMissingBlogIndexingCoveragePosts(input);
  const missingSlugs = missingPosts.map((post) => post.slug);
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
