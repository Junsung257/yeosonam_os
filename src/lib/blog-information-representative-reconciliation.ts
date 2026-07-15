import { buildBlogInformationPlan } from './blog-information-planner';
import {
  buildBlogInformationRepresentativeKey,
  readBlogInformationRepresentativeIdentity,
  type BlogInformationRepresentativeIdentity,
  type BlogInformationRepresentativeRecord,
} from './blog-information-representative';

export type BlogInformationReconciliationDecision =
  | 'BACKFILL_CANDIDATE'
  | 'MULTIPLE_CANDIDATES'
  | 'CANONICAL_MISMATCH'
  | 'SLUG_COLLISION'
  | 'REVIEW_UNKNOWN'
  | 'HIGH_RISK'
  | 'REGISTRY_PRESENT'
  | 'UNCLASSIFIED';

export interface BlogInformationLegacyArticle {
  id: string;
  slug: string;
  title: string;
  markdown: string;
  destination?: string | null;
  status: string;
  productId?: string | null;
  reviewStatus?: string | null;
  publishedAt?: string | null;
  generationMeta?: Record<string, unknown> | null;
}

export interface BlogInformationReconciliationItem {
  representativeKey: string | null;
  identity: BlogInformationRepresentativeIdentity | null;
  decision: BlogInformationReconciliationDecision;
  candidateIds: string[];
  candidateSlugs: string[];
  canonicalCreativeId: string | null;
  canonicalSlug: string | null;
  reasons: string[];
  mayApply: boolean;
}

export interface BlogInformationReconciliationReport {
  dryRun: true;
  databaseWrites: 0;
  items: BlogInformationReconciliationItem[];
  counts: Record<BlogInformationReconciliationDecision, number>;
}

export const BLOG_INFORMATION_RECONCILIATION_CONFIRMATION = 'BACKFILL_SAFE_INFORMATION_REPRESENTATIVES';
export const BLOG_INFORMATION_RECONCILIATION_ENV_VALUE = 'I_UNDERSTAND_THIS_WRITES_REPRESENTATIVES';

function inferIdentity(article: BlogInformationLegacyArticle): BlogInformationRepresentativeIdentity | null {
  const persisted = readBlogInformationRepresentativeIdentity(article.generationMeta);
  if (persisted) return persisted;
  const plan = buildBlogInformationPlan({
    topic: article.title,
    primaryKeyword: article.title,
    destination: article.destination,
  });
  if (!plan.passed || !plan.destinationId || plan.intent === 'general') return null;
  return {
    destinationId: plan.destinationId,
    intent: plan.intent,
    audience: plan.audience,
    locale: plan.locale,
  };
}

function isHighRisk(identity: BlogInformationRepresentativeIdentity): boolean {
  return identity.intent === 'entry_requirements' || identity.intent === 'travel_insurance';
}

function reviewUnknown(article: BlogInformationLegacyArticle): boolean {
  return Boolean(article.reviewStatus && !['none', 'approved'].includes(article.reviewStatus));
}

export function reconcileBlogInformationRepresentativesDryRun(input: {
  articles: BlogInformationLegacyArticle[];
  representatives: BlogInformationRepresentativeRecord[];
}): BlogInformationReconciliationReport {
  const publicArticles = input.articles.filter((article) =>
    !article.productId && article.status === 'published' && article.slug.trim().length > 0);
  const registryByKey = new Map(input.representatives.map((record) => [record.representativeKey, record]));
  const slugCounts = new Map<string, number>();
  for (const article of publicArticles) slugCounts.set(article.slug, (slugCounts.get(article.slug) ?? 0) + 1);
  const groups = new Map<string, { identity: BlogInformationRepresentativeIdentity; articles: BlogInformationLegacyArticle[] }>();
  const unclassified: BlogInformationReconciliationItem[] = [];

  for (const article of publicArticles) {
    const identity = inferIdentity(article);
    if (!identity) {
      unclassified.push({
        representativeKey: null,
        identity: null,
        decision: 'UNCLASSIFIED',
        candidateIds: [article.id],
        candidateSlugs: [article.slug],
        canonicalCreativeId: null,
        canonicalSlug: null,
        reasons: ['intent_or_destination_unresolved'],
        mayApply: false,
      });
      continue;
    }
    const key = buildBlogInformationRepresentativeKey(identity);
    const current = groups.get(key);
    groups.set(key, { identity, articles: [...(current?.articles ?? []), article] });
  }

  const items = [...groups.entries()].map<BlogInformationReconciliationItem>(([representativeKey, group]) => {
    const articles = [...group.articles].sort((left, right) => {
      const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : Number.POSITIVE_INFINITY;
      const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : Number.POSITIVE_INFINITY;
      return leftTime - rightTime || left.slug.localeCompare(right.slug);
    });
    const candidateIds = articles.map((article) => article.id);
    const candidateSlugs = articles.map((article) => article.slug);
    const existing = registryByKey.get(representativeKey);
    if (existing) {
      const matches = articles.some((article) =>
        article.id === existing.canonicalCreativeId && article.slug === existing.canonicalSlug);
      return {
        representativeKey,
        identity: group.identity,
        decision: existing.status === 'active' && matches ? 'REGISTRY_PRESENT' : 'CANONICAL_MISMATCH',
        candidateIds,
        candidateSlugs,
        canonicalCreativeId: existing.canonicalCreativeId,
        canonicalSlug: existing.canonicalSlug,
        reasons: existing.status === 'active' && matches
          ? ['active_registry_keeps_existing_public_url']
          : [`registry_${existing.status}_does_not_match_public_candidate`],
        mayApply: false,
      };
    }
    if (isHighRisk(group.identity)) {
      return {
        representativeKey,
        identity: group.identity,
        decision: 'HIGH_RISK',
        candidateIds,
        candidateSlugs,
        canonicalCreativeId: null,
        canonicalSlug: null,
        reasons: ['high_risk_never_auto_backfilled'],
        mayApply: false,
      };
    }
    if (articles.some((article) => (slugCounts.get(article.slug) ?? 0) > 1)) {
      return {
        representativeKey,
        identity: group.identity,
        decision: 'SLUG_COLLISION',
        candidateIds,
        candidateSlugs,
        canonicalCreativeId: null,
        canonicalSlug: null,
        reasons: ['same_slug_points_to_multiple_public_rows'],
        mayApply: false,
      };
    }
    if (articles.length > 1) {
      return {
        representativeKey,
        identity: group.identity,
        decision: 'MULTIPLE_CANDIDATES',
        candidateIds,
        candidateSlugs,
        canonicalCreativeId: articles[0].id,
        canonicalSlug: articles[0].slug,
        reasons: ['multiple_public_candidates_require_human_canonical_selection'],
        mayApply: false,
      };
    }
    const article = articles[0];
    if (reviewUnknown(article)) {
      return {
        representativeKey,
        identity: group.identity,
        decision: 'REVIEW_UNKNOWN',
        candidateIds,
        candidateSlugs,
        canonicalCreativeId: article.id,
        canonicalSlug: article.slug,
        reasons: [`review_status_${article.reviewStatus}`],
        mayApply: false,
      };
    }
    return {
      representativeKey,
      identity: group.identity,
      decision: 'BACKFILL_CANDIDATE',
      candidateIds,
      candidateSlugs,
      canonicalCreativeId: article.id,
      canonicalSlug: article.slug,
      reasons: ['exactly_one_safe_public_candidate', 'preserve_existing_public_url'],
      mayApply: true,
    };
  });

  const allItems = [...items, ...unclassified].sort((left, right) =>
    (left.representativeKey ?? left.candidateSlugs[0] ?? '').localeCompare(
      right.representativeKey ?? right.candidateSlugs[0] ?? '',
    ));
  const counts = Object.fromEntries(
    [
      'BACKFILL_CANDIDATE', 'MULTIPLE_CANDIDATES', 'CANONICAL_MISMATCH', 'SLUG_COLLISION',
      'REVIEW_UNKNOWN', 'HIGH_RISK', 'REGISTRY_PRESENT', 'UNCLASSIFIED',
    ].map((decision) => [
      decision,
      allItems.filter((item) => item.decision === decision).length,
    ]),
  ) as Record<BlogInformationReconciliationDecision, number>;
  return { dryRun: true, databaseWrites: 0, items: allItems, counts };
}

export function assertBlogInformationReconciliationApplyAuthorized(input: {
  apply: boolean;
  confirmation?: string | null;
  environmentValue?: string | null;
}): void {
  if (!input.apply) return;
  if (input.confirmation !== BLOG_INFORMATION_RECONCILIATION_CONFIRMATION
    || input.environmentValue !== BLOG_INFORMATION_RECONCILIATION_ENV_VALUE) {
    throw new Error('blog_information_reconciliation_apply_not_authorized');
  }
}
