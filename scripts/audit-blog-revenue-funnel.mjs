#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const files = {
  blogPage: 'src/app/blog/[slug]/page.tsx',
  tracker: 'src/components/BlogTracker.tsx',
  engagement: 'src/app/api/blog-engagement/route.ts',
  recommendationApi: 'src/app/api/tracking/recommendation/route.ts',
  recommendationEvents: 'src/lib/recommendation-events.ts',
  blogRecommendationTracker: 'src/components/blog/BlogProductRecommendationTracker.tsx',
  recommendBest: 'src/lib/scoring/recommend.ts',
  packageSearch: 'src/app/api/packages/search/route.ts',
  packageDetail: 'src/app/packages/[id]/DetailClient.tsx',
  packageInquiry: 'src/app/api/packages/inquiry/route.ts',
  scheduler: 'src/lib/blog-scheduler.ts',
  publisher: 'src/app/api/cron/blog-publisher/route.ts',
  dailySummary: 'src/app/api/cron/blog-daily-summary/route.ts',
  blogLearn: 'src/app/api/cron/blog-learn/route.ts',
};

const source = Object.fromEntries(
  Object.entries(files).map(([key, file]) => [key, read(file)]),
);

const checks = [
  {
    id: 'blog_detail_has_engagement_tracker',
    weight: 6,
    passed: /<BlogTracker\s+contentCreativeId=\{post\.id\}/.test(source.blogPage),
    evidence: files.blogPage,
  },
  {
    id: 'blog_cta_click_creates_content_attribution',
    weight: 7,
    passed: /content_attribution_events/.test(source.engagement) && /event_type:\s*'click'/.test(source.engagement),
    evidence: files.engagement,
  },
  {
    id: 'booking_conversion_keeps_blog_content_attribution',
    weight: 7,
    passed: /content_creative_id/.test(source.tracker) && /event_type:\s*'booking'/.test(read('src/app/api/tracking/route.ts')),
    evidence: 'src/app/api/tracking/route.ts',
  },
  {
    id: 'info_blog_uses_destination_fallback_for_product_recommendations',
    weight: 8,
    passed: /getRelatedProducts\([^)]*post\.destination/.test(source.blogPage) || /const\s+effectiveDestination\s*=/.test(source.blogPage),
    evidence: files.blogPage,
    remediation: 'Use post.destination as the fallback for info posts, not only pkg?.destination.',
  },
  {
    id: 'blog_product_cards_use_scoring_engine',
    weight: 10,
    passed: /recommendBestPackages|package_scores|buildRecommendationDisplay/.test(source.blogPage),
    evidence: files.blogPage,
    remediation: 'Use recommendBestPackages/package_scores for blog cards instead of price-only sorting.',
  },
  {
    id: 'blog_recommendation_source_supported',
    weight: 8,
    passed: /source:\s*'[^']*blog/.test(source.recommendationApi) || /'blog'/.test(source.recommendationApi.match(/source:\s*[^;]+;/s)?.[0] ?? ''),
    evidence: files.recommendationApi,
    remediation: 'Add blog to recommendation_outcomes source taxonomy.',
  },
  {
    id: 'blog_product_impressions_are_recorded',
    weight: 8,
    passed: /BlogProductRecommendationTracker/.test(source.blogPage) &&
      /\/api\/tracking\/recommendation/.test(source.blogRecommendationTracker) &&
      /source:\s*'blog'/.test(source.blogRecommendationTracker) &&
      /content_creative_id/.test(source.blogRecommendationTracker),
    evidence: files.blogRecommendationTracker,
    remediation: 'Record product-card impressions with content_creative_id, rank, intent, and session_id.',
  },
  {
    id: 'blog_product_clicks_capture_package_id',
    weight: 8,
    passed: /data-blog-product-id|blog_product_id|package_id/.test(source.tracker) && /\/api\/tracking\/recommendation/.test(source.tracker),
    evidence: files.tracker,
    remediation: 'Track clicked package_id and recommendation rank from blog product links.',
  },
  {
    id: 'tracker_counts_package_list_cta',
    weight: 5,
    passed: /\/packages(?:\/|\?)/.test(source.tracker),
    evidence: files.tracker,
    remediation: 'Count /packages?destination=... as a CTA, not only /packages/{id}.',
  },
  {
    id: 'package_detail_updates_recommendation_inquiry_with_session',
    weight: 6,
    passed: /outcome:\s*'inquiry'/.test(source.packageDetail) && /session_id:\s*getSessionId\(\)/.test(source.packageDetail),
    evidence: files.packageDetail,
  },
  {
    id: 'package_inquiry_endpoint_updates_recommendation_outcome',
    weight: 5,
    passed: /recommendation_outcomes|\/api\/tracking\/recommendation|recordClick|recordBookingConversion/.test(source.packageInquiry),
    evidence: files.packageInquiry,
    remediation: 'When a package inquiry arrives, update recommendation_outcomes/recommendation_events for the same session/package.',
  },
  {
    id: 'daily_publish_target_is_exactly_5',
    weight: 7,
    passed: /MIN_POSTS_PER_DAY\s*=\s*5/.test(source.scheduler) &&
      /MAX_POSTS_PER_DAY\s*=\s*5/.test(source.scheduler) &&
      /DEFAULT_POSTS_PER_DAY\s*=\s*5/.test(source.scheduler) &&
      /Math\.min\(MAX_POSTS_PER_DAY,\s*Math\.max\(MIN_POSTS_PER_DAY/.test(source.scheduler),
    evidence: files.scheduler,
    remediation: 'Keep the scheduler policy fixed at five researched posts per KST day.',
  },
  {
    id: 'publisher_respects_cumulative_slot_quota',
    weight: 6,
    passed: /normalizeDailyPostTarget/.test(source.publisher) &&
      /calculateBlogPublishSlotQuota/.test(source.publisher) &&
      /remainingDueNow/.test(source.publisher) &&
      /claim_queue_items/.test(source.publisher) &&
      /publishedThisRun\s*>=\s*remainingDueNow/.test(source.publisher) &&
      /remainingAfterRun:\s*Math\.max\(0,\s*remainingDueNow\s*-\s*publishedCount\)/.test(source.publisher) &&
      /MAX_CANDIDATE_POOL/.test(source.publisher),
    evidence: files.publisher,
    remediation: 'Limit each run to the cumulative KST slot quota and report both due-now and daily remainder.',
  },
  {
    id: 'daily_summary_alerts_when_under_configured_target',
    weight: 6,
    passed: /normalizeDailyPostTarget/.test(source.dailySummary) &&
      /under_daily_target:\s*\(pubRes\.count\s*\|\|\s*0\)\s*<\s*dailyTarget/.test(source.dailySummary) &&
      /if\s*\(summary\.under_daily_target\)/.test(source.dailySummary),
    evidence: files.dailySummary,
    remediation: 'Alert and trigger recovery whenever the configured five-post daily target is missed.',
  },
  {
    id: 'blog_learning_consumes_editorial_and_funnel_failures',
    weight: 6,
    passed: /intent_quality|recommendation_outcomes|blog_engagement_logs|editorial|funnel/.test(source.blogLearn),
    evidence: files.blogLearn,
    remediation: 'blog-learn should learn from intent_quality failures and blog recommendation funnel outcomes.',
  },
];

const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0);
const passedWeight = checks.filter((c) => c.passed).reduce((sum, c) => sum + c.weight, 0);
const score = Math.round((passedWeight / totalWeight) * 100);
const failed = checks.filter((c) => !c.passed);

const result = {
  score,
  passed: checks.length - failed.length,
  failed: failed.length,
  total: checks.length,
  failed_checks: failed.map(({ id, weight, evidence, remediation }) => ({ id, weight, evidence, remediation })),
  checks,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Blog revenue funnel readiness: ${score}/100 (${result.passed}/${result.total} checks passed)`);
  if (failed.length > 0) {
    console.log('\nFailed checks:');
    for (const item of failed) {
      console.log(`- ${item.id} (${item.weight}pt): ${item.remediation ?? item.evidence}`);
    }
  }
}

if (process.argv.includes('--strict') && score < 100) {
  process.exitCode = 1;
}
