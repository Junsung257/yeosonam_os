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
    expect(rank).toContain('metrics.filter((metric) => metric.date === date)');
    expect(rank).toContain("'blog_search_performance'");
    expect(rank).toContain('gsc_observed_metrics_empty');
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

  it('requires observed GSC demand before queuing a representative refresh', () => {
    const route = source('src/app/api/cron/blog-regenerate-zero-click/route.ts');
    const dailySummary = source('src/app/api/cron/blog-daily-summary/route.ts');
    const vercel = source('vercel.json');
    const workflow = source('.github/workflows/blog-external-cron.yml');

    expect(route).toContain('const MAX_BATCH = 2');
    expect(route).toContain('const PERFORMANCE_MATURITY_DAYS = 28');
    expect(route).toContain('const WINDOW_DAYS = 28');
    expect(route).toContain('const COOLDOWN_DAYS = 28');
    expect(route).toContain('searchObservationAvailable');
    expect(route).toContain(".in('source', ['gsc', 'gsc-page'])");
    expect(route).toContain(".select('slug, clicks, impressions, position')");
    expect(route).toContain('evaluateBlogSearchRefreshOpportunityV4(');
    expect(route).toContain('gsc_signal: true');
    expect(route).toContain('gsc_impressions: searchOpportunity.impressions');
    expect(route).toContain("status: 'demand_signal_missing'");
    expect(route).toContain("'gsc_position_4_20_material_refresh'");
    expect(dailySummary).toContain('evaluateBlogSearchRefreshOpportunityV4(');
    expect(dailySummary).toContain(".in('source', ['gsc', 'gsc-page'])");
    expect(dailySummary).toContain('gsc_impressions: searchEvidence.impressions');
    expect(dailySummary).toContain("regenerated_reason: '28일 GSC 관측 순위 4~20 — 대표 URL material refresh'");
    expect(dailySummary).not.toContain('28일 GSC 노출 0 — 수요·색인·의도 재검토');
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
    expect(route).toContain("reason: selectionSource === 'search_refresh' ? 'search_refresh' : 'quality_gap'");
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
    // V4 keeps this recovery route available for the external maintenance
    // workflow, but removes it from Vercel's producer cron allowlist so it
    // cannot compete with the durable content factory.
    expect(vercel).not.toContain('"/api/cron/blog-regenerate-zero-click"');
    expect(vercel).not.toContain('"schedule": "45 12 * * *"');
    expect(workflow).toContain("cron: '50 12 * * *'");
    expect(workflow).toContain('endpoint="blog-regenerate-zero-click"');
  });
});
