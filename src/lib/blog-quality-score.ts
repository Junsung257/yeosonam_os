import type { BlogIntentQualityReport } from './blog-content-intent';
import type { QualityGateReport } from './blog-quality-gate';
import type { ReadabilityResult } from './blog-readability';
import type { SeoScoreResult } from './blog-seo-scorer';

export type BlogQualityIssueSeverity = 'critical' | 'major' | 'minor';
export type BlogQualityStatus = 'score_100' | 'fail';

export interface BlogQualityIssue {
  code: string;
  severity: BlogQualityIssueSeverity;
  message: string;
  source: string;
  evidence?: Record<string, unknown>;
}

export type BlogQualityComponentId =
  | 'quality_gate'
  | 'seo'
  | 'readability'
  | 'editorial'
  | 'render'
  | 'image'
  | 'business'
  | 'search';

export interface BlogQualityComponent {
  id: BlogQualityComponentId;
  passed: boolean;
  score: number | null;
  issues: BlogQualityIssue[];
}

export interface BlogQualityScoreReport {
  status: BlogQualityStatus;
  passed: boolean;
  score: number;
  isPerfect: boolean;
  issues: BlogQualityIssue[];
  components: BlogQualityComponent[];
  summary: string;
  checkedAt: string;
}

export interface BlogQualityAuditPayload {
  failed?: boolean;
  error?: string | null;
  score?: number | null;
  summary?: {
    failed?: number;
    errors?: number;
    score?: number;
    averageScore?: number;
    ok?: boolean;
  } | null;
  failedExamples?: unknown[];
}

export interface BlogQualityScoreInput {
  qualityGate?: QualityGateReport | null;
  seoScore?: SeoScoreResult | null;
  readability?: ReadabilityResult | null;
  editorial?: BlogIntentQualityReport | null;
  renderedAudit?: BlogQualityAuditPayload | null;
  imageAudit?: BlogQualityAuditPayload | null;
  revenueAudit?: BlogQualityAuditPayload | null;
  searchAudit?: BlogQualityAuditPayload | null;
}

export interface BlogQualityFleetReport {
  ok: boolean;
  fleetScore: number;
  total: number;
  score100Count: number;
  failedCount: number;
  issueCounts: Record<string, number>;
}

const PENALTY: Record<BlogQualityIssueSeverity, number> = {
  critical: 25,
  major: 15,
  minor: 5,
};

const CRITICAL_QUALITY_GATES = new Set([
  'render_integrity',
  'structure_integrity',
  'intent_quality',
  'image_quality',
  'links',
  'cta',
  'readability',
  'ai_readability',
]);

const CRITICAL_SEO_DETAILS = new Set([
  'title',
  'meta_description',
  'heading_structure',
  'image_seo',
  'internal_links_cta',
  'structured_data',
  'helpful_content_eeat',
]);

function scoreFromIssues(issues: BlogQualityIssue[]): number {
  const penalty = issues.reduce((sum, issue) => sum + PENALTY[issue.severity], 0);
  return Math.max(0, 100 - penalty);
}

function component(
  id: BlogQualityComponentId,
  score: number | null,
  issues: BlogQualityIssue[],
  sourcePassed = true,
): BlogQualityComponent {
  return {
    id,
    passed: sourcePassed && issues.length === 0,
    score,
    issues,
  };
}

function qualityGateComponent(report: QualityGateReport): BlogQualityComponent {
  const issues: BlogQualityIssue[] = report.gates
    .filter((gate) => !gate.passed)
    .map((gate) => ({
      code: `quality_gate.${gate.gate}`,
      severity: CRITICAL_QUALITY_GATES.has(gate.gate) ? 'critical' as const : 'major' as const,
      message: gate.reason || `${gate.gate} gate failed`,
      source: 'quality_gate',
      evidence: gate.evidence,
    }));

  if (!report.passed && issues.length === 0) {
    issues.push({
      code: 'quality_gate.failed',
      severity: 'major',
      message: report.summary || 'Quality gate failed without detailed gate evidence.',
      source: 'quality_gate',
    });
  }

  return component('quality_gate', issues.length === 0 ? 100 : scoreFromIssues(issues), issues, report.passed);
}

function seoComponent(report: SeoScoreResult): BlogQualityComponent {
  const issues: BlogQualityIssue[] = [];
  for (const detail of report.details) {
    if (detail.status === 'pass') continue;
    issues.push({
      code: `seo.${detail.name}`,
      severity: detail.status === 'fail'
        ? (CRITICAL_SEO_DETAILS.has(detail.name) ? 'critical' : 'major')
        : 'minor',
      message: detail.message || `${detail.name} SEO detail is ${detail.status}`,
      source: 'seo',
      evidence: {
        score: detail.score,
        maxScore: detail.maxScore,
        status: detail.status,
      },
    });
  }

  if (!report.passed && issues.length === 0) {
    issues.push({
      code: 'seo.failed',
      severity: 'major',
      message: report.summary || 'SEO score failed without detailed evidence.',
      source: 'seo',
      evidence: { score: report.score, maxScore: report.maxScore },
    });
  }

  return component('seo', report.score, issues, report.passed);
}

function readabilityComponent(report: ReadabilityResult): BlogQualityComponent {
  const issues: BlogQualityIssue[] = report.issues.map((message, index) => ({
    code: `readability.issue_${index + 1}`,
    severity: /100|long|wall|duplicate|반복|장문/i.test(message) ? 'major' as const : 'minor' as const,
    message,
    source: 'readability',
    evidence: {
      score: report.score,
      avg_sentence_len: report.avg_sentence_len,
      long_sentence_count: report.long_sentence_count,
      double_negative_count: report.double_negative_count,
    },
  }));

  if (report.score < 80 && issues.length === 0) {
    issues.push({
      code: 'readability.low_score',
      severity: 'minor',
      message: `Readability score ${report.score}/100 is below the strict 80-point publishing target.`,
      source: 'readability',
      evidence: { score: report.score },
    });
  }

  return component('readability', report.score, issues, report.score >= 80);
}

function editorialComponent(report: BlogIntentQualityReport): BlogQualityComponent {
  const issues: BlogQualityIssue[] = report.issues.map((issue) => ({
    code: `editorial.${issue.code}`,
    severity: issue.severity === 'critical' ? 'critical' as const : 'minor' as const,
    message: issue.message,
    source: 'editorial',
    evidence: issue.evidence,
  }));

  if (!report.passed && issues.length === 0) {
    issues.push({
      code: 'editorial.failed',
      severity: 'major',
      message: `Editorial intent quality failed at ${report.score}/100.`,
      source: 'editorial',
      evidence: { score: report.score, intent: report.intent },
    });
  }

  return component('editorial', report.score, issues, report.passed);
}

function auditComponent(
  id: Extract<BlogQualityComponentId, 'render' | 'image' | 'business' | 'search'>,
  payload: BlogQualityAuditPayload,
): BlogQualityComponent {
  const issues: BlogQualityIssue[] = [];
  const failed = payload.summary?.failed ?? (Array.isArray(payload.failedExamples) ? payload.failedExamples.length : 0);
  const errors = payload.summary?.errors ?? 0;
  const ok = payload.summary?.ok ?? (!payload.failed && !payload.error && failed === 0 && errors === 0);

  if (payload.error) {
    issues.push({
      code: `${id}.error`,
      severity: 'critical',
      message: payload.error,
      source: id,
    });
  }
  if (errors > 0) {
    issues.push({
      code: `${id}.errors`,
      severity: 'critical',
      message: `${id} audit reported ${errors} runtime errors.`,
      source: id,
      evidence: { errors },
    });
  }
  if (failed > 0) {
    issues.push({
      code: `${id}.failed_items`,
      severity: 'major',
      message: `${id} audit reported ${failed} failed items.`,
      source: id,
      evidence: { failed, failedExamples: payload.failedExamples?.slice(0, 5) },
    });
  }
  if (payload.failed && issues.length === 0) {
    issues.push({
      code: `${id}.failed`,
      severity: 'major',
      message: `${id} audit failed.`,
      source: id,
    });
  }

  const score = typeof payload.score === 'number'
    ? payload.score
    : typeof payload.summary?.score === 'number'
      ? payload.summary.score
      : typeof payload.summary?.averageScore === 'number'
        ? payload.summary.averageScore
        : null;

  return component(id, score, issues, ok);
}

export function calculateBlogQualityScore(input: BlogQualityScoreInput): BlogQualityScoreReport {
  const components: BlogQualityComponent[] = [];

  if (input.qualityGate) components.push(qualityGateComponent(input.qualityGate));
  if (input.seoScore) components.push(seoComponent(input.seoScore));
  if (input.readability) components.push(readabilityComponent(input.readability));
  if (input.editorial) components.push(editorialComponent(input.editorial));
  if (input.renderedAudit) components.push(auditComponent('render', input.renderedAudit));
  if (input.imageAudit) components.push(auditComponent('image', input.imageAudit));
  if (input.revenueAudit) components.push(auditComponent('business', input.revenueAudit));
  if (input.searchAudit) components.push(auditComponent('search', input.searchAudit));

  const issues = components.flatMap((item) => item.issues);
  const isPerfect = components.length > 0 && issues.length === 0 && components.every((item) => item.passed);
  const score = isPerfect ? 100 : scoreFromIssues(issues);

  return {
    status: isPerfect ? 'score_100' : 'fail',
    passed: isPerfect,
    score,
    isPerfect,
    issues,
    components,
    summary: isPerfect
      ? 'Blog quality score 100/100: all strict gates passed.'
      : `Blog quality score ${score}/100: ${issues.length} issue(s), ${components.filter((item) => !item.passed).length} failed component(s).`,
    checkedAt: new Date().toISOString(),
  };
}

export function aggregateBlogQualityFleet(reports: BlogQualityScoreReport[]): BlogQualityFleetReport {
  const total = reports.length;
  const score100Count = reports.filter((report) => report.isPerfect).length;
  const failedCount = total - score100Count;
  const issueCounts: Record<string, number> = {};

  for (const report of reports) {
    for (const issue of report.issues) {
      issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1;
    }
  }

  return {
    ok: total > 0 && failedCount === 0,
    fleetScore: total === 0 ? 0 : Math.floor((score100Count / total) * 100),
    total,
    score100Count,
    failedCount,
    issueCounts,
  };
}
