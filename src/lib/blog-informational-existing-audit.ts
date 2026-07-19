import {
  extractBlogInformationClaims,
} from './blog-information-claim-validator';
import {
  inferBlogInformationIntent,
  inspectBlogInformationMarkdown,
  validateBlogDestinationEntity,
  type BlogInformationIntent,
} from './blog-information-contract';
import { buildBlogInformationPlan } from './blog-information-planner';
import { buildBlogInformationRepresentativeKey } from './blog-information-representative';
import { inspectBlogRenderedSeoQuality } from './blog-rendered-seo-quality';

export type BlogInformationAuditAction = 'KEEP' | 'REWRITE' | 'MERGE' | 'REMOVE' | 'HIGH_RISK_REVIEW';
export type BlogInformationAuditCtaStatus = 'CONFIGURED' | 'RELATED_ONLY' | 'LEGACY_UNCONFIGURED' | 'PRODUCT_OUT_OF_SCOPE';

export interface BlogInformationExistingAuditInput {
  id: string;
  slug: string;
  seo_title?: string | null;
  seo_description?: string | null;
  blog_html?: string | null;
  destination?: string | null;
  product_id?: string | null;
  published_at?: string | null;
  generation_meta?: Record<string, unknown> | null;
  validated_claim_fingerprints?: string[];
}

export interface BlogInformationExistingAuditItem {
  articleId: string;
  slug: string;
  inferredIntent: BlogInformationIntent;
  destinationValidity: {
    valid: boolean;
    destination: string | null;
    issues: string[];
  };
  duplicateGroup: {
    representativeKey: string | null;
    canonicalSlug: string | null;
    memberSlugs: string[];
  };
  missingFacts: string[];
  unsupportedClaims: Array<{
    fingerprint: string;
    type: string;
    text: string;
  }>;
  renderIssues: string[];
  ctaStatus: BlogInformationAuditCtaStatus;
  recommendedAction: BlogInformationAuditAction;
  confidence: number;
  reasons: string[];
}

export interface BlogInformationExistingAuditReport {
  schemaVersion: 1;
  dryRun: true;
  databaseReads: 0;
  databaseWrites: 0;
  externalCalls: 0;
  source: string;
  auditedAt: string;
  total: number;
  counts: Record<BlogInformationAuditAction, number>;
  items: BlogInformationExistingAuditItem[];
}

interface DuplicateGroup {
  representativeKey: string;
  canonicalSlug: string;
  memberSlugs: string[];
}

function textLength(markdown: string): number {
  return markdown
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_`>\-[\]()!|:]/g, ' ')
    .replace(/\s+/g, '')
    .length;
}

function hasInformationIdentity(meta?: Record<string, unknown> | null): boolean {
  const brief = meta?.content_brief;
  return Boolean(brief && typeof brief === 'object' && !Array.isArray(brief));
}

function buildDuplicateGroups(rows: BlogInformationExistingAuditInput[]): Map<string, DuplicateGroup> {
  const members = new Map<string, BlogInformationExistingAuditInput[]>();
  for (const row of rows) {
    if (row.product_id || textLength(row.blog_html || '') < 120) continue;
    const title = row.seo_title || row.slug;
    const intentType = inferBlogInformationIntent({
      topic: `${title} ${row.seo_description || title}`,
      primaryKeyword: title,
      destination: row.destination,
    });
    const plan = buildBlogInformationPlan({
      intentType,
      topic: title,
      primaryKeyword: title,
      destination: row.destination,
    });
    // The dry-run audit must still surface duplicate legacy `general` rows.
    // They are not publishable, but hiding their representative collision would
    // make reconciliation less safe.
    if (!plan.destinationId) continue;
    const key = buildBlogInformationRepresentativeKey({
      destinationId: plan.destinationId,
      intent: plan.intent,
      audience: plan.audience,
      locale: plan.locale,
    });
    members.set(key, [...(members.get(key) ?? []), row]);
  }

  const groups = new Map<string, DuplicateGroup>();
  for (const [representativeKey, groupRows] of members.entries()) {
    const sorted = [...groupRows].sort((left, right) => {
      const leftTime = left.published_at ? Date.parse(left.published_at) : Number.POSITIVE_INFINITY;
      const rightTime = right.published_at ? Date.parse(right.published_at) : Number.POSITIVE_INFINITY;
      return leftTime - rightTime || left.slug.localeCompare(right.slug);
    });
    const group = {
      representativeKey,
      canonicalSlug: sorted[0]?.slug ?? '',
      memberSlugs: sorted.map((row) => row.slug),
    };
    for (const row of sorted) groups.set(row.id, group);
  }
  return groups;
}

function classify(input: {
  row: BlogInformationExistingAuditInput;
  intent: BlogInformationIntent;
  destinationValid: boolean;
  duplicate: DuplicateGroup | null;
  missingFacts: string[];
  unsupportedClaimCount: number;
  renderIssues: string[];
  bodyLength: number;
}): Pick<BlogInformationExistingAuditItem, 'recommendedAction' | 'confidence' | 'reasons'> {
  if (input.row.product_id) {
    return { recommendedAction: 'KEEP', confidence: 1, reasons: ['product_content_out_of_scope'] };
  }
  if (input.intent === 'entry_requirements' || input.intent === 'travel_insurance') {
    return { recommendedAction: 'HIGH_RISK_REVIEW', confidence: 0.98, reasons: ['high_risk_intent_requires_human_review'] };
  }
  if (input.duplicate && input.duplicate.memberSlugs.length > 1 && input.duplicate.canonicalSlug !== input.row.slug) {
    return { recommendedAction: 'MERGE', confidence: 0.96, reasons: ['noncanonical_representative_duplicate'] };
  }
  if (!input.row.slug.trim() || !input.row.seo_title?.trim() || input.bodyLength < 120) {
    return { recommendedAction: 'REMOVE', confidence: 0.95, reasons: ['missing_or_unusable_public_body'] };
  }

  const rewriteReasons: string[] = [];
  if (!input.destinationValid) rewriteReasons.push('invalid_destination');
  if (input.missingFacts.length > 0) rewriteReasons.push('missing_required_facts');
  if (input.unsupportedClaimCount > 0) rewriteReasons.push('unsupported_claims');
  if (input.renderIssues.length > 0) rewriteReasons.push('render_quality_issues');
  if (rewriteReasons.length > 0) {
    return { recommendedAction: 'REWRITE', confidence: 0.88, reasons: rewriteReasons };
  }
  return { recommendedAction: 'KEEP', confidence: 0.84, reasons: ['no_actionable_information_quality_issue'] };
}

export async function auditBlogInformationPostsDryRun(
  rows: BlogInformationExistingAuditInput[],
  options: {
    source?: string;
    ctaSettingsConfigured?: boolean;
    auditedAt?: string;
  } = {},
): Promise<BlogInformationExistingAuditReport> {
  const duplicateGroups = buildDuplicateGroups(rows);
  const items = await Promise.all(rows.map(async (row): Promise<BlogInformationExistingAuditItem> => {
    const markdown = row.blog_html || '';
    const title = row.seo_title || row.slug;
    const description = row.seo_description || title;
    const inferredIntent = inferBlogInformationIntent({
      topic: `${title} ${description}`,
      primaryKeyword: title,
      destination: row.destination,
    });
    const destination = validateBlogDestinationEntity(row.destination);
    const plan = buildBlogInformationPlan({
      intentType: inferredIntent,
      topic: title,
      primaryKeyword: title,
      destination: row.destination,
    });
    const content = row.product_id
      ? null
      : inspectBlogInformationMarkdown({ markdown, contract: plan.contract });
    const validatedFingerprints = new Set(row.validated_claim_fingerprints ?? []);
    const unsupportedClaims = row.product_id
      ? []
      : extractBlogInformationClaims(markdown)
          .filter((claim) => !validatedFingerprints.has(claim.claimFingerprint))
          .map((claim) => ({
            fingerprint: claim.claimFingerprint,
            type: claim.claimType,
            text: claim.claimText,
          }));
    const rendered = row.product_id || textLength(markdown) < 120
      ? null
      : await inspectBlogRenderedSeoQuality({
          markdown,
          slug: row.slug,
          title,
          description,
          destination: row.destination,
          generationMeta: row.generation_meta ?? null,
        });
    const duplicate = duplicateGroups.get(row.id) ?? null;
    const ctaStatus: BlogInformationAuditCtaStatus = row.product_id
      ? 'PRODUCT_OUT_OF_SCOPE'
      : hasInformationIdentity(row.generation_meta)
        ? options.ctaSettingsConfigured ? 'CONFIGURED' : 'RELATED_ONLY'
        : 'LEGACY_UNCONFIGURED';
    const classification = classify({
      row,
      intent: inferredIntent,
      destinationValid: destination.valid,
      duplicate,
      missingFacts: content?.missingSlots ?? [],
      unsupportedClaimCount: unsupportedClaims.length,
      renderIssues: rendered?.issues.map((issue) => issue.code) ?? [],
      bodyLength: textLength(markdown),
    });

    return {
      articleId: row.id,
      slug: row.slug,
      inferredIntent,
      destinationValidity: {
        valid: destination.valid,
        destination: destination.destination,
        issues: destination.issues.map((issue) => issue.code),
      },
      duplicateGroup: {
        representativeKey: duplicate?.representativeKey ?? null,
        canonicalSlug: duplicate?.canonicalSlug ?? null,
        memberSlugs: duplicate?.memberSlugs ?? [],
      },
      missingFacts: content?.missingSlots ?? [],
      unsupportedClaims,
      renderIssues: rendered?.issues.map((issue) => issue.code) ?? [],
      ctaStatus,
      ...classification,
    };
  }));

  const emptyCounts: Record<BlogInformationAuditAction, number> = {
    KEEP: 0,
    REWRITE: 0,
    MERGE: 0,
    REMOVE: 0,
    HIGH_RISK_REVIEW: 0,
  };
  const counts = items.reduce((acc, item) => {
    acc[item.recommendedAction] += 1;
    return acc;
  }, emptyCounts);

  return {
    schemaVersion: 1,
    dryRun: true,
    databaseReads: 0,
    databaseWrites: 0,
    externalCalls: 0,
    source: options.source || 'provided_local_snapshot',
    auditedAt: options.auditedAt || new Date().toISOString(),
    total: items.length,
    counts,
    items,
  };
}

export function formatBlogInformationExistingAuditSummary(
  report: BlogInformationExistingAuditReport,
): string {
  const lines = [
    '# 정보성 기존 글 감사 — M11 dry-run 요약',
    '',
    `- 입력: ${report.source} (${report.total}건)`,
    `- 분류: KEEP ${report.counts.KEEP} / REWRITE ${report.counts.REWRITE} / MERGE ${report.counts.MERGE} / REMOVE ${report.counts.REMOVE} / HIGH_RISK_REVIEW ${report.counts.HIGH_RISK_REVIEW}`,
    `- DB 읽기/쓰기: ${report.databaseReads}/${report.databaseWrites}`,
    `- 외부 호출: ${report.externalCalls}`,
    '',
    '| 글 | 의도 | 목적지 | 중복 | 누락 사실 | 미지원 claim | 렌더 이슈 | CTA | 권장 조치 | 신뢰도 |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | ---: |',
    ...report.items.map((item) => [
      item.slug,
      item.inferredIntent,
      item.destinationValidity.valid ? 'valid' : 'invalid',
      item.duplicateGroup.memberSlugs.length,
      item.missingFacts.length,
      item.unsupportedClaims.length,
      item.renderIssues.length,
      item.ctaStatus,
      item.recommendedAction,
      item.confidence.toFixed(2),
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
    '',
    '> 권장 조치만 생성한 읽기 전용 보고서입니다. redirect, merge, delete, rewrite, publish, DB update는 실행하지 않았습니다.',
    '',
  ];
  return lines.join('\n');
}
