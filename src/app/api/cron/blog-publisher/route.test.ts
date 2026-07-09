import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('blog publisher quota recovery contract', () => {
  const routeSource = () => readFileSync(
    join(process.cwd(), 'src/app/api/cron/blog-publisher/route.ts'),
    'utf8',
  );

  it('keeps attempting replacement candidates until the daily quota is filled or time is unsafe', () => {
    const source = routeSource();

    expect(source).toContain("readBoundedIntEnv('BLOG_PUBLISHER_MAX_EXTRA_CLAIM_ROUNDS', 4, 1, 8)");
    expect(source).toContain('while (publishedThisRun < remainingToday && extraClaimRounds < MAX_EXTRA_CLAIM_ROUNDS)');
    expect(source).toContain('getPublisherExtraClaimRecoveryPlan');
    expect(source).toContain('ensureDailyPublishableQueue({');
    expect(source).toContain('claim_queue_items');
    expect(source).toContain('publishedThisRun += 1');
    expect(source).toContain('candidateFailures.push');
  });

  it('uses deterministic information fallback instead of stopping on repairable info failures', () => {
    const source = routeSource();

    expect(source).toContain('shouldUseFastDeterministicInfoFallback');
    expect(source).toContain('applyDeterministicInfoFallback');
    expect(source).toContain('deterministic_fast_fallback');
    expect(source).toContain('deterministic info fallback before publish');
  });

  it('repairs common article-quality failures instead of treating them as terminal blockers', () => {
    const source = routeSource();

    expect(source).toContain("from '@/lib/blog-article-quality-v2-repair'");
    expect(source).toContain('repairArticleQualityV2Specifics');
    expect(source).toContain('const finalArticleRepair = repairArticleQualityV2Specifics');
  });

  it('returns claimed but unattempted rows to the queue for the next recovery run', () => {
    const source = routeSource();

    expect(source).toContain('releaseUnattemptedClaimedQueueItems');
    expect(source).toContain('timeBudgetClaimRelease');
    expect(source).toContain('getUnattemptedClaimReleaseIds');
    expect(source).toContain('time_budget_claim_release_failed');
  });

  it('does not reintroduce old mechanical SEO prompt rules that create AI-looking posts', () => {
    const source = routeSource();

    expect(source).not.toContain('H2 8개 고정');
    expect(source).not.toContain('H2 7~9개');
    expect(source).not.toContain('==핵심 문장==');
    expect(source).not.toContain('운영팀 직접 답사 톤');
    expect(source).not.toContain('여행 완벽 가이드');
    expect(source).not.toContain('지금 한국인이 가장 많이 묻는');
  });
});
