export type BlogPublishPreflightStatus = 'pass' | 'warn' | 'block';

export type BlogPublishPreflightCheck = {
  id: string;
  status: BlogPublishPreflightStatus;
  severity: 'info' | 'warning' | 'high' | 'critical';
  detail: string;
  next_action: string;
};

export type BlogPublishPreflightInput = {
  dailyTarget: number;
  publishedToday: number;
  publishableCandidateCount: number;
  duplicateCandidateCount: number;
  evidenceInsufficientCount: number;
  candidateShortage: boolean;
  actionableFailedCount: number;
  staleGeneratingCount: number;
  manualReviewCount?: number;
  overdueQueuedCount?: number;
  indexingOutboxMissingCount: number;
  indexingOutboxCoverageRate?: number | null;
  recentPosts: Array<{
    slug?: string | null;
    quality_gate?: Record<string, unknown> | null;
    generation_meta?: Record<string, unknown> | null;
    seo_score?: Record<string, unknown> | number | string | null;
    readability_score?: number | string | null;
  }>;
  minimumCanarySamples?: number;
};

export type BlogPublishPreflightResult = {
  status: BlogPublishPreflightStatus;
  score: number;
  remaining_today: number;
  canary_sample_count: number;
  canary_ready: boolean;
  checks: BlogPublishPreflightCheck[];
  blockers: BlogPublishPreflightCheck[];
  warnings: BlogPublishPreflightCheck[];
  next_action: string;
};

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function seoScoreValue(value: unknown): number {
  if (typeof value === 'object' && value !== null && 'score' in value) {
    return asNumber((value as { score?: unknown }).score);
  }
  return asNumber(value);
}

function hasContentBrief(meta: Record<string, unknown> | null | undefined): boolean {
  return Boolean(meta?.content_brief && typeof meta.content_brief === 'object');
}

function recentPostPasses(post: BlogPublishPreflightInput['recentPosts'][number]): boolean {
  const qualityPassed = post.quality_gate?.passed !== false;
  const seoScore = seoScoreValue(post.seo_score);
  const readabilityScore = asNumber(post.readability_score);
  return qualityPassed
    && hasContentBrief(post.generation_meta)
    && (seoScore === 0 || seoScore >= 85)
    && (readabilityScore === 0 || readabilityScore >= 70);
}

function rankStatus(status: BlogPublishPreflightStatus): number {
  return { pass: 0, warn: 1, block: 2 }[status];
}

function worstStatus(checks: BlogPublishPreflightCheck[]): BlogPublishPreflightStatus {
  return checks.reduce(
    (worst, check) => (rankStatus(check.status) > rankStatus(worst) ? check.status : worst),
    'pass' as BlogPublishPreflightStatus,
  );
}

export function evaluateBlogPublishPreflight(input: BlogPublishPreflightInput): BlogPublishPreflightResult {
  const dailyTarget = Math.max(1, Math.round(input.dailyTarget || 4));
  const publishedToday = Math.max(0, Math.round(input.publishedToday || 0));
  const remainingToday = Math.max(0, dailyTarget - publishedToday);
  const minimumCanarySamples = Math.max(1, Math.round(input.minimumCanarySamples ?? 3));
  const recentSample = input.recentPosts.slice(0, Math.max(minimumCanarySamples, 3));
  const canaryPassCount = recentSample.filter(recentPostPasses).length;
  const canaryFailures = recentSample.length - canaryPassCount;
  const checks: BlogPublishPreflightCheck[] = [];

  if (remainingToday === 0) {
    checks.push({
      id: 'daily_quota_reached',
      status: 'pass',
      severity: 'info',
      detail: `Today already reached ${publishedToday}/${dailyTarget} posts.`,
      next_action: 'No publish needed until the next slot/day.',
    });
  } else if (input.publishableCandidateCount < remainingToday) {
    checks.push({
      id: 'publishable_inventory',
      status: 'block',
      severity: 'critical',
      detail: `Only ${input.publishableCandidateCount} publishable candidate(s) for ${remainingToday} remaining slot(s).`,
      next_action: 'Refill or repair candidates before claiming queue rows.',
    });
  } else if (input.candidateShortage || input.publishableCandidateCount < dailyTarget * 2) {
    checks.push({
      id: 'publishable_inventory',
      status: 'warn',
      severity: 'warning',
      detail: `${input.publishableCandidateCount} publishable candidate(s); below the ${dailyTarget * 2} buffer.`,
      next_action: 'Run scheduler/refill before the next publish window.',
    });
  } else {
    checks.push({
      id: 'publishable_inventory',
      status: 'pass',
      severity: 'info',
      detail: `${input.publishableCandidateCount} publishable candidate(s) are available.`,
      next_action: 'Proceed with normal publisher slots.',
    });
  }

  if (input.evidenceInsufficientCount > 0) {
    checks.push({
      id: 'evidence_readiness',
      status: remainingToday > 0 ? 'block' : 'warn',
      severity: remainingToday > 0 ? 'high' : 'warning',
      detail: `${input.evidenceInsufficientCount} candidate(s) still need evidence/product proof.`,
      next_action: 'Collect evidence or repair linked product proof before requeueing.',
    });
  }

  const manualReviewCount = input.manualReviewCount ?? 0;
  const overdueQueuedCount = input.overdueQueuedCount ?? 0;

  if (input.actionableFailedCount > 0 || input.staleGeneratingCount > 0) {
    checks.push({
      id: 'queue_health',
      status: 'block',
      severity: 'high',
      detail: `${input.actionableFailedCount} actionable failed row(s), ${input.staleGeneratingCount} stale generating row(s).`,
      next_action: 'Resolve queue failures before relying on the next publisher run.',
    });
  } else if ((remainingToday > 0 && manualReviewCount > 0) || (overdueQueuedCount > 0 && input.publishableCandidateCount < dailyTarget * 2)) {
    checks.push({
      id: 'queue_health',
      status: 'warn',
      severity: 'warning',
      detail: `${manualReviewCount} manual review row(s), ${overdueQueuedCount} overdue queued row(s).`,
      next_action: 'Review backlog, but publisher can continue if publishable candidates are sufficient.',
    });
  } else {
    checks.push({
      id: 'queue_health',
      status: 'pass',
      severity: 'info',
      detail: overdueQueuedCount > 0
        ? `${overdueQueuedCount} overdue queued row(s) exist, but publishable inventory is sufficient and publisher preflight can reschedule them.`
        : manualReviewCount > 0
          ? `${manualReviewCount} manual review row(s) exist, but today's quota is already met and no actionable queue rows are blocking publishing.`
        : 'No actionable failed or stale generating queue rows.',
      next_action: 'Keep normal queue preflight enabled.',
    });
  }

  if (input.indexingOutboxMissingCount > 0) {
    checks.push({
      id: 'indexing_outbox',
      status: 'block',
      severity: 'critical',
      detail: `${input.indexingOutboxMissingCount} recent published post(s) are missing durable indexing jobs.`,
      next_action: 'Backfill outbox jobs and fix publisher enqueue before publishing more.',
    });
  } else {
    checks.push({
      id: 'indexing_outbox',
      status: 'pass',
      severity: 'info',
      detail: `Recent indexing outbox coverage is ${input.indexingOutboxCoverageRate ?? 100}%.`,
      next_action: 'Keep indexing worker independent from publisher health.',
    });
  }

  if (input.duplicateCandidateCount > 0) {
    checks.push({
      id: 'duplicate_pressure',
      status: 'warn',
      severity: 'warning',
      detail: `${input.duplicateCandidateCount} duplicate candidate(s) are present.`,
      next_action: 'Quarantine duplicates and refill with new micro-angles.',
    });
  }

  if (recentSample.length < minimumCanarySamples) {
    checks.push({
      id: 'canary_recent_quality_sample',
      status: 'warn',
      severity: 'warning',
      detail: `Only ${recentSample.length}/${minimumCanarySamples} recent post sample(s) are available for canary confidence.`,
      next_action: 'Keep publisher conservative until three recent quality samples exist.',
    });
  } else if (canaryFailures > 0) {
    checks.push({
      id: 'canary_recent_quality_sample',
      status: 'block',
      severity: 'high',
      detail: `${canaryFailures}/${recentSample.length} recent sample(s) failed quality/brief/SEO/readability evidence.`,
      next_action: 'Repair recent quality failures before expanding automated publishing.',
    });
  } else {
    checks.push({
      id: 'canary_recent_quality_sample',
      status: 'pass',
      severity: 'info',
      detail: `${canaryPassCount}/${recentSample.length} recent samples pass quality evidence.`,
      next_action: 'Safe to continue normal slots; use these samples as the canary baseline.',
    });
  }

  const blockers = checks.filter((check) => check.status === 'block');
  const warnings = checks.filter((check) => check.status === 'warn');
  const status = worstStatus(checks);
  const score = Math.max(0, 100 - blockers.length * 25 - warnings.length * 8);

  return {
    status,
    score,
    remaining_today: remainingToday,
    canary_sample_count: canaryPassCount,
    canary_ready: blockers.length === 0 && canaryPassCount >= minimumCanarySamples,
    checks,
    blockers,
    warnings,
    next_action: blockers[0]?.next_action ?? warnings[0]?.next_action ?? 'Preflight passed. Continue scheduled blog publishing.',
  };
}
