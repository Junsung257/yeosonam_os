import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('blog search data and published quality recovery contract', () => {
  it('gives long-running search collection jobs their declared function budget', () => {
    const gsc = source('src/app/api/cron/gsc-index-rank/route.ts');
    const rank = source('src/app/api/cron/rank-tracking/route.ts');
    const serp = source('src/app/api/cron/serp-rank-snapshot/route.ts');

    expect(gsc).toContain('handlerTimeoutMs: 285_000');
    expect(rank).toContain('handlerTimeoutMs: 285_000');
    expect(rank).toContain('buildBlogGscQueryRankHistoryRows(metrics, dateStr)');
    expect(serp).toContain('handlerTimeoutMs: 55_000');
  });

  it('mirrors search collection outside Vercel Cron and fails on collection errors', () => {
    const workflow = source('.github/workflows/blog-external-cron.yml');

    expect(workflow).toContain("cron: '40 21 * * *'");
    expect(workflow).toContain("cron: '40 2 * * *'");
    expect(workflow).toContain("cron: '10 3 * * *'");
    expect(workflow).toContain('endpoint="serp-rank-snapshot"');
    expect(workflow).toContain('endpoint="gsc-index-rank"');
    expect(workflow).toContain('endpoint="rank-tracking"');
    expect(workflow).toContain('reported data collection errors');
  });

  it('keeps published quality recovery active when rank history is empty', () => {
    const route = source('src/app/api/cron/blog-regenerate-zero-click/route.ts');
    const vercel = source('vercel.json');
    const workflow = source('.github/workflows/blog-external-cron.yml');

    expect(route).toContain('const MAX_BATCH = 2');
    expect(route).toContain('const PERFORMANCE_MATURITY_DAYS = 14');
    expect(route).toContain(".in('source', ['gsc', 'gsc-page'])");
    expect(route).toContain('generation_meta,published_at');
    expect(route).toContain('!hasVerifiedResearch(post.generation_meta)');
    expect(route).toContain('publishedAt <= performanceMaturityCutoff');
    expect(route).toContain('evaluatePublishedBlogQualityUpgradeCandidate(post)');
    expect(route).toContain('hasReviewedBlogResearchCoverage({');
    expect(route).toContain('destination: decision.researchDestination');
    expect(route).toContain("status: 'research_coverage_missing'");
    expect(route).toContain('evaluateBlogPublicCustomerQuality({');
    expect(route).toContain('PUBLIC_BLOG_CUSTOMER_PUBLISH_MIN_SCORE');
    expect(route).toContain('publicQualityGapSet.has(post.id)');
    expect(route).toContain("? 'public_customer_quality'");
    expect(route).toContain("reason: selectionSource === 'zero_click' ? 'zero_click' : 'quality_gap'");
    expect(route).toContain("'public_customer_quality_upgrade'");
    expect(route).toContain("priority: selectionSource === 'public_customer_quality'");
    expect(route).toContain('public_quality_gap_candidates: publicQualityGapSet.size');
    expect(route).toContain('canonical_redirect_candidates: redirectedPublishedPosts.length');
    expect(route).toContain('isBlogSlugRedirectSource(post.slug)');
    expect(route).toContain('representative_conflict');
    expect(route).toContain('selectedRepresentativeKeys');
    expect(route).toContain('same_run_representative_conflict');
    expect(route).toContain('representative_key: decision.representativeKey');
    expect(route).toContain("const representativeRace = queueError.code === '23505'");
    expect(route).toContain('atomic_publish_replace: true');
    expect(route).not.toContain("message: 'rank_history 데이터 없음'");
    expect(vercel).toContain('"/api/cron/blog-regenerate-zero-click"');
    expect(vercel).toContain('"schedule": "45 12 * * *"');
    expect(workflow).toContain("cron: '50 12 * * *'");
    expect(workflow).toContain('endpoint="blog-regenerate-zero-click"');
  });
});
