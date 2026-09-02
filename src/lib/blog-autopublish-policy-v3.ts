import {
  parseBlogPublicationRampStage,
  type BlogPublicationRampStage,
} from './blog-publication-rollout';

export const BLOG_AUTOPUBLISH_MODES = ['draft_only', 'reviewed_only', 'live'] as const;
export const BLOG_DAILY_PUBLISH_MAX_V4 = 5 as const;

export type BlogAutopublishMode = (typeof BLOG_AUTOPUBLISH_MODES)[number];

export interface BlogAutopublishPolicyV3 {
  requestedMode: BlogAutopublishMode;
  mode: BlogAutopublishMode;
  dailyPublishCap: number;
  requestedDailyPublishCap: number;
  /** Environment hard ceiling. The durable DB rollout state may be lower, never higher. */
  publicationRampStage: BlogPublicationRampStage;
  autoRampEnabled: boolean;
  autoRollbackEnabled: boolean;
  maxWeatherShare30d: number;
  maxSameArchetypeInLast10: number;
  requireDemandSignal: boolean;
  deploymentProvenance: BlogDeploymentProvenanceV3;
}

export interface BlogDeploymentProvenanceV3 {
  required: boolean;
  passed: boolean;
  environment: string | null;
  expectedGitRef: string;
  actualGitRef: string | null;
  commitSha: string | null;
  reasons: string[];
}

export interface BlogDemandSignalInput {
  gsc?: boolean;
  naver?: boolean;
  customerQuestionCount?: number | null;
  activeProductRelation?: boolean;
  verifiedOperatorNote?: boolean;
  editorApprovedSeed?: boolean;
  monthlySearchVolume?: number | null;
  trendScore?: number | null;
}

export interface BlogPublishDecisionInput {
  reviewStatus?: string | null;
  allGatesPassed: boolean;
  deterministicFallback?: boolean;
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  demand?: BlogDemandSignalInput | null;
  publishedToday?: number;
  weatherShare30d?: number;
  isWeatherContent?: boolean;
  sameArchetypeInLast10?: number;
}

export interface BlogPublishDecision {
  publish: boolean;
  contentStatus: 'draft' | 'published';
  queueStatus: 'pending_review' | 'published';
  runPublicSideEffects: boolean;
  reasons: string[];
}

function boundedNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function envBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === '') return fallback;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  return fallback;
}

export function evaluateBlogDeploymentProvenanceV3(
  env: Record<string, string | undefined> = process.env,
): BlogDeploymentProvenanceV3 {
  const environment = String(env.VERCEL_ENV || '').trim() || null;
  const required = environment === 'production';
  const expectedGitRef = String(env.BLOG_PRODUCTION_ALLOWED_GIT_REF || 'main').trim() || 'main';
  const actualGitRef = String(env.VERCEL_GIT_COMMIT_REF || '').trim() || null;
  const commitSha = String(env.VERCEL_GIT_COMMIT_SHA || '').trim() || null;
  const reasons: string[] = [];

  if (required && !actualGitRef) reasons.push('production_git_ref_missing');
  if (required && actualGitRef && actualGitRef !== expectedGitRef) {
    reasons.push('production_git_ref_not_allowed');
  }
  if (required && !commitSha) reasons.push('production_commit_sha_missing');

  return {
    required,
    passed: !required || reasons.length === 0,
    environment,
    expectedGitRef,
    actualGitRef,
    commitSha,
    reasons,
  };
}

export function readBlogAutopublishPolicyV3(
  env: Record<string, string | undefined> = process.env,
): BlogAutopublishPolicyV3 {
  const rawMode = String(env.BLOG_AUTOPUBLISH_MODE || '').trim();
  const requestedMode = (BLOG_AUTOPUBLISH_MODES as readonly string[]).includes(rawMode)
    ? rawMode as BlogAutopublishMode
    : 'draft_only';
  const deploymentProvenance = evaluateBlogDeploymentProvenanceV3(env);
  const mode = deploymentProvenance.passed ? requestedMode : 'draft_only';
  // AI-CONTEXT: publishing_policies.posts_per_day is the operational SSOT.
  // This value is only a hard safety ceiling; the retired 30/day environment
  // target must never override the DB policy again.
  const requestedDailyPublishCap = BLOG_DAILY_PUBLISH_MAX_V4;
  const publicationRampStage = parseBlogPublicationRampStage(env.BLOG_PUBLICATION_RAMP_STAGE);

  return {
    requestedMode,
    mode,
    // V4: publishing_policies is the only volume SSOT. Legacy rollout stage
    // names remain for freeze/recovery compatibility but never lower or raise
    // the five-post hard safety ceiling.
    dailyPublishCap: BLOG_DAILY_PUBLISH_MAX_V4,
    requestedDailyPublishCap,
    publicationRampStage,
    autoRampEnabled: envBoolean(env.BLOG_AUTO_RAMP_ENABLED, false),
    autoRollbackEnabled: envBoolean(env.BLOG_AUTO_ROLLBACK_ENABLED, true),
    maxWeatherShare30d: boundedNumber(env.BLOG_MAX_WEATHER_SHARE_30D, 0.2, 0, 1),
    maxSameArchetypeInLast10: Math.floor(
      boundedNumber(env.BLOG_MAX_SAME_ARCHETYPE_IN_LAST_10, 2, 0, 10),
    ),
    requireDemandSignal: envBoolean(env.BLOG_REQUIRE_DEMAND_SIGNAL, true),
    deploymentProvenance,
  };
}

export function hasVerifiedBlogDemandSignal(signal: BlogDemandSignalInput | null | undefined): boolean {
  if (!signal) return false;
  return signal.gsc === true
    || signal.naver === true
    || Number(signal.customerQuestionCount || 0) > 0
    || signal.activeProductRelation === true
    || signal.verifiedOperatorNote === true
    || signal.editorApprovedSeed === true
    || (typeof signal.monthlySearchVolume === 'number' && signal.monthlySearchVolume > 0)
    || (typeof signal.trendScore === 'number' && signal.trendScore > 0);
}

export function evaluateBlogAutopublishDecisionV3(
  policy: BlogAutopublishPolicyV3,
  input: BlogPublishDecisionInput,
): BlogPublishDecision {
  const reasons: string[] = [];
  if (policy.mode === 'draft_only') reasons.push('autopublish_mode_draft_only');
  if (!input.allGatesPassed) reasons.push('quality_or_evidence_gate_failed');
  if (input.deterministicFallback) reasons.push('deterministic_fallback_not_publishable');
  if (policy.requireDemandSignal && !hasVerifiedBlogDemandSignal(input.demand)) {
    reasons.push('verified_demand_signal_missing');
  }
  if ((input.publishedToday || 0) >= policy.dailyPublishCap) reasons.push('daily_publish_cap_reached');
  if (input.isWeatherContent && (input.weatherShare30d || 0) > policy.maxWeatherShare30d) {
    reasons.push('weather_share_cap_exceeded');
  }
  if ((input.sameArchetypeInLast10 || 0) >= policy.maxSameArchetypeInLast10) {
    reasons.push('archetype_saturation_cap_reached');
  }

  const approvalRequired = policy.mode === 'reviewed_only' || input.riskLevel === 'HIGH';
  if (approvalRequired && input.reviewStatus !== 'approved') reasons.push('human_approval_required');

  const publish = reasons.length === 0;
  return {
    publish,
    contentStatus: publish ? 'published' : 'draft',
    queueStatus: publish ? 'published' : 'pending_review',
    runPublicSideEffects: publish,
    reasons,
  };
}
