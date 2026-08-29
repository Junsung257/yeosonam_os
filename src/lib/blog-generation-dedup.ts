import { createHash } from 'node:crypto';
import { normalizeBlogTitleSkeletonV3 } from './blog-corpus-diversity-v3';

const BLOG_GENERATION_DEDUP_VERSION = 'blog-generation-dedup-v1';
export const BLOG_GENERATION_DEDUP_TITLE_NEAR_THRESHOLD = 0.78;

export type BlogGenerationContentKind = 'information' | 'product' | 'general' | 'unknown';
export type BlogGenerationDedupAction = 'allow' | 'review' | 'block';

export interface BlogGenerationDedupCandidate {
  id?: string | null;
  title: string;
  slug?: string | null;
  destination?: string | null;
  productId?: string | null;
  contentKind?: BlogGenerationContentKind;
  allowExistingCreativeId?: string | null;
}

export interface BlogGenerationDedupExisting {
  id: string;
  title?: string | null;
  seoTitle?: string | null;
  slug?: string | null;
  destination?: string | null;
  productId?: string | null;
  contentKind?: BlogGenerationContentKind;
  status?: string | null;
}

export interface BlogGenerationDedupMatch {
  kind: 'slug' | 'title_exact' | 'title_skeleton' | 'title_near';
  existingId: string;
  existingTitle: string | null;
  existingSlug: string | null;
  similarity: number;
  reason: string;
}

export interface BlogGenerationDedupReport {
  action: BlogGenerationDedupAction;
  passed: boolean;
  titleKey: string;
  dedupKey: string;
  similarity: number;
  matches: BlogGenerationDedupMatch[];
  reason: string;
}

function text(value: string | null | undefined): string {
  return typeof value === 'string' ? value.normalize('NFKC').trim() : '';
}

function comparableDestination(value: string | null | undefined): string {
  return text(value).toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, '');
}

function comparableTitle(value: string): string {
  return normalizeBlogTitleSkeletonV3(value)
    .replace(/\{number\}\s*(?:년|year)/giu, '{number}')
    .replace(/\b여소남\b/gu, '')
    .replace(/\b(?:blog|blogger|naver)\b/giu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function titleTrigrams(value: string): Set<string> {
  const compact = comparableTitle(value).replace(/\s+/gu, '');
  if (!compact) return new Set();
  if (compact.length < 3) return new Set([compact]);
  const result = new Set<string>();
  for (let index = 0; index <= compact.length - 3; index += 1) {
    result.add(compact.slice(index, index + 3));
  }
  return result;
}

export function normalizeBlogGenerationTitle(title: string): string {
  return comparableTitle(title);
}

function normalizeBlogGenerationSlug(slug: string | null | undefined): string {
  return text(slug).toLowerCase().replace(/\/+$/u, '');
}

export function buildBlogGenerationTitleKey(title: string): string {
  const normalized = normalizeBlogGenerationTitle(title);
  if (!normalized) return '';
  return normalized;
}

export function buildBlogGenerationDedupKey(title: string): string {
  const titleKey = buildBlogGenerationTitleKey(title);
  if (!titleKey) return '';
  const digest = createHash('sha256').update(titleKey, 'utf8').digest('hex');
  return `v1|title|${digest}`;
}

export function inferBlogGenerationContentKind(input: {
  productId?: string | null;
  contentType?: string | null;
  category?: string | null;
}): BlogGenerationContentKind {
  if (input.productId) return 'product';
  if (input.contentType === 'guide' || input.contentType === 'pillar' || input.category === 'info') {
    return 'information';
  }
  return 'unknown';
}

function rowTitle(row: BlogGenerationDedupExisting): string {
  return text(row.seoTitle) || text(row.title);
}

function sameContentKind(
  candidate: BlogGenerationDedupCandidate,
  existing: BlogGenerationDedupExisting,
): boolean {
  const candidateKind = candidate.contentKind ?? 'unknown';
  const existingKind = existing.contentKind ?? 'unknown';
  if (candidateKind === 'unknown' || existingKind === 'unknown') return true;
  return candidateKind === existingKind;
}

function sameDestination(
  candidate: BlogGenerationDedupCandidate,
  existing: BlogGenerationDedupExisting,
): boolean {
  const left = comparableDestination(candidate.destination);
  const right = comparableDestination(existing.destination);
  if (!left || !right) return !left && !right;
  return left === right;
}

function titleSimilarity(left: string, right: string): number {
  const leftSet = titleTrigrams(left);
  const rightSet = titleTrigrams(right);
  if (!leftSet.size || !rightSet.size) return 0;
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  return (2 * intersection) / (leftSet.size + rightSet.size);
}

function matchForCandidate(
  candidate: BlogGenerationDedupCandidate,
  existing: BlogGenerationDedupExisting,
  titleKey: string,
  slug: string,
): BlogGenerationDedupMatch | null {
  if (candidate.allowExistingCreativeId && existing.id === candidate.allowExistingCreativeId) return null;

  const existingTitle = rowTitle(existing);
  const existingTitleKey = existingTitle ? buildBlogGenerationTitleKey(existingTitle) : '';
  const existingSlug = normalizeBlogGenerationSlug(existing.slug);
  if (slug && existingSlug && slug === existingSlug) {
    return {
      kind: 'slug',
      existingId: existing.id,
      existingTitle: existingTitle || null,
      existingSlug: existing.slug ?? null,
      similarity: 1,
      reason: 'slug_already_exists',
    };
  }
  if (titleKey && existingTitleKey && titleKey === existingTitleKey) {
    const exact = text(candidate.title).toLowerCase() === existingTitle.toLowerCase();
    return {
      kind: exact ? 'title_exact' : 'title_skeleton',
      existingId: existing.id,
      existingTitle: existingTitle || null,
      existingSlug: existing.slug ?? null,
      similarity: 1,
      reason: exact ? 'exact_title_already_exists' : 'normalized_title_already_exists',
    };
  }

  if (!existingTitle || !sameContentKind(candidate, existing) || !sameDestination(candidate, existing)) return null;
  const similarity = titleSimilarity(candidate.title, existingTitle);
  if (similarity < BLOG_GENERATION_DEDUP_TITLE_NEAR_THRESHOLD) return null;
  return {
    kind: 'title_near',
    existingId: existing.id,
    existingTitle,
    existingSlug: existing.slug ?? null,
    similarity,
    reason: 'near_duplicate_title_requires_review',
  };
}

export function evaluateBlogGenerationDedup(
  candidate: BlogGenerationDedupCandidate,
  existing: BlogGenerationDedupExisting[],
): BlogGenerationDedupReport {
  const titleKey = buildBlogGenerationTitleKey(candidate.title);
  const dedupKey = buildBlogGenerationDedupKey(candidate.title);
  if (!titleKey) {
    return {
      action: 'block',
      passed: false,
      titleKey,
      dedupKey,
      similarity: 0,
      matches: [],
      reason: 'missing_title',
    };
  }

  const slug = normalizeBlogGenerationSlug(candidate.slug);
  const matches = existing
    .map((row) => matchForCandidate(candidate, row, titleKey, slug))
    .filter((match): match is BlogGenerationDedupMatch => match !== null)
    .sort((left, right) => right.similarity - left.similarity);
  const hardMatch = matches.find((match) => match.kind !== 'title_near');
  if (hardMatch) {
    return {
      action: 'block',
      passed: false,
      titleKey,
      dedupKey,
      similarity: hardMatch.similarity,
      matches: matches.slice(0, 10),
      reason: hardMatch.reason,
    };
  }
  const nearMatch = matches[0];
  if (nearMatch) {
    return {
      action: 'review',
      passed: false,
      titleKey,
      dedupKey,
      similarity: nearMatch.similarity,
      matches: matches.slice(0, 10),
      reason: nearMatch.reason,
    };
  }
  return {
    action: 'allow',
    passed: true,
    titleKey,
    dedupKey,
    similarity: 0,
    matches: [],
    reason: 'no_existing_title_or_slug_collision',
  };
}

export function buildBlogGenerationDedupMetadata(input: {
  report: BlogGenerationDedupReport;
  checkedAt?: string;
  claimOwner?: string | null;
}): Record<string, unknown> {
  const match = input.report.matches[0] ?? null;
  return {
    version: BLOG_GENERATION_DEDUP_VERSION,
    action: input.report.action,
    title_key: input.report.titleKey,
    dedup_key: input.report.dedupKey,
    reason: input.report.reason,
    similarity: input.report.similarity,
    matched_creative_id: match?.existingId ?? null,
    matched_slug: match?.existingSlug ?? null,
    checked_at: input.checkedAt ?? new Date().toISOString(),
    claim_owner: input.claimOwner ?? null,
  };
}
