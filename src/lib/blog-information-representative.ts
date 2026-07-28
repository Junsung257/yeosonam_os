import { createHash } from 'node:crypto';
import {
  BLOG_INFORMATION_INTENTS,
  type BlogInformationIntent,
} from './blog-information-contract';
import type { BlogInformationAudience } from './blog-information-planner';

export interface BlogInformationRepresentativeIdentity {
  destinationId: string;
  intent: BlogInformationIntent;
  audience: BlogInformationAudience;
  locale: string;
}

export interface BlogInformationRepresentativeRecord extends BlogInformationRepresentativeIdentity {
  representativeKey: string;
  canonicalCreativeId: string | null;
  canonicalSlug: string | null;
  status: 'reserved' | 'active' | 'retired';
  reservationOwner: string;
}

export interface BlogInformationDuplicateCandidate extends BlogInformationRepresentativeIdentity {
  slug: string;
  title: string;
  markdown: string;
}

export interface BlogInformationDuplicateDecision {
  action: 'RESERVE_CREATE' | 'RESUME_RESERVATION' | 'UPDATE_EXISTING' | 'WAIT_FOR_EXISTING' | 'REVIEW_RETIRED';
  representativeKey: string;
  canonicalCreativeId: string | null;
  canonicalSlug: string | null;
  exactDuplicate: boolean;
  nearDuplicate: boolean;
  similarity: number;
  reason: string;
}

export interface BlogInformationDuplicateAuditRow extends BlogInformationRepresentativeIdentity {
  slug: string;
  publishedAt?: string | null;
}

export interface BlogInformationDuplicateAuditGroup {
  representativeKey: string;
  canonicalSlug: string;
  duplicateSlugs: string[];
  proposedAction: 'KEEP' | 'MERGE_REVIEW';
}

const BLOG_INFORMATION_AUDIENCES: BlogInformationAudience[] = [
  'general',
  'family',
  'couple',
  'solo',
  'senior',
  'student',
];

function normalizeKeyPart(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{Letter}\p{Number}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeComparable(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\b(?:19|20)\d{2}\b/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function trigrams(value: string): Set<string> {
  const compact = normalizeComparable(value).replace(/\s+/g, '');
  if (compact.length < 3) return new Set(compact ? [compact] : []);
  const result = new Set<string>();
  for (let index = 0; index <= compact.length - 3; index += 1) {
    result.add(compact.slice(index, index + 3));
  }
  return result;
}

export function calculateBlogInformationSimilarity(left: string, right: string): number {
  const leftSet = trigrams(left);
  const rightSet = trigrams(right);
  if (leftSet.size === 0 && rightSet.size === 0) return 1;
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const total = leftSet.size + rightSet.size;
  return total === 0 ? 0 : (2 * intersection) / total;
}

export function buildBlogInformationRepresentativeKey(
  identity: BlogInformationRepresentativeIdentity,
): string {
  const destinationId = normalizeKeyPart(identity.destinationId);
  const locale = identity.locale.trim();
  if (!destinationId) throw new Error('blog_information_representative_missing_destination');
  if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(locale)) {
    throw new Error('blog_information_representative_invalid_locale');
  }
  return `v1|${destinationId}|${identity.intent}|${identity.audience}|${locale}`;
}

export function createBlogInformationContentHash(title: string, markdown: string): string {
  return createHash('sha256')
    .update(`${normalizeComparable(title)}\n${normalizeComparable(markdown)}`, 'utf8')
    .digest('hex');
}

export function decideBlogInformationDuplicate(input: {
  candidate: BlogInformationDuplicateCandidate;
  existing: BlogInformationRepresentativeRecord | null;
  reservationOwner: string;
  existingTitle?: string | null;
  existingMarkdown?: string | null;
}): BlogInformationDuplicateDecision {
  const representativeKey = buildBlogInformationRepresentativeKey(input.candidate);
  if (!input.existing) {
    return {
      action: 'RESERVE_CREATE',
      representativeKey,
      canonicalCreativeId: null,
      canonicalSlug: null,
      exactDuplicate: false,
      nearDuplicate: false,
      similarity: 0,
      reason: 'no_existing_representative',
    };
  }

  const existingText = `${input.existingTitle || ''}\n${input.existingMarkdown || ''}`;
  const candidateText = `${input.candidate.title}\n${input.candidate.markdown}`;
  const similarity = existingText.trim()
    ? calculateBlogInformationSimilarity(candidateText, existingText)
    : 0;
  const exactDuplicate = Boolean(existingText.trim())
    && createBlogInformationContentHash(input.candidate.title, input.candidate.markdown)
      === createBlogInformationContentHash(input.existingTitle || '', input.existingMarkdown || '');
  const nearDuplicate = !exactDuplicate && similarity >= 0.75;

  if (input.existing.status === 'active') {
    return {
      action: 'UPDATE_EXISTING',
      representativeKey,
      canonicalCreativeId: input.existing.canonicalCreativeId,
      canonicalSlug: input.existing.canonicalSlug,
      exactDuplicate,
      nearDuplicate,
      similarity,
      reason: exactDuplicate ? 'exact_duplicate' : nearDuplicate ? 'near_duplicate' : 'representative_key_exists',
    };
  }
  if (input.existing.status === 'retired') {
    return {
      action: 'REVIEW_RETIRED',
      representativeKey,
      canonicalCreativeId: input.existing.canonicalCreativeId,
      canonicalSlug: input.existing.canonicalSlug,
      exactDuplicate,
      nearDuplicate,
      similarity,
      reason: 'retired_representative_requires_editor_decision',
    };
  }
  if (input.existing.reservationOwner === input.reservationOwner) {
    return {
      action: 'RESUME_RESERVATION',
      representativeKey,
      canonicalCreativeId: input.existing.canonicalCreativeId,
      canonicalSlug: input.existing.canonicalSlug,
      exactDuplicate,
      nearDuplicate,
      similarity,
      reason: 'same_owner_retry',
    };
  }
  return {
    action: 'WAIT_FOR_EXISTING',
    representativeKey,
    canonicalCreativeId: input.existing.canonicalCreativeId,
    canonicalSlug: input.existing.canonicalSlug,
    exactDuplicate,
    nearDuplicate,
    similarity,
    reason: 'representative_reserved_by_another_candidate',
  };
}

export function canUpgradePublishedBlogForRepresentative(input: {
  decision: BlogInformationDuplicateDecision;
  targetCreativeId: string;
}): boolean {
  if (['RESERVE_CREATE', 'RESUME_RESERVATION'].includes(input.decision.action)) return true;
  return input.decision.action === 'UPDATE_EXISTING'
    && input.decision.canonicalCreativeId === input.targetCreativeId;
}

export function readBlogInformationRepresentativeIdentity(
  generationMeta?: Record<string, unknown> | null,
): BlogInformationRepresentativeIdentity | null {
  const contentBrief = generationMeta?.content_brief;
  if (!contentBrief || typeof contentBrief !== 'object' || Array.isArray(contentBrief)) return null;
  const brief = contentBrief as Record<string, unknown>;
  const destinationId = typeof brief.destination_id === 'string' ? brief.destination_id : null;
  const intent = typeof brief.intent_type === 'string' ? brief.intent_type : null;
  const audience = typeof brief.audience === 'string' ? brief.audience : null;
  const locale = typeof brief.locale === 'string' ? brief.locale : null;
  if (!destinationId || !intent || !audience || !locale) return null;
  if (!(BLOG_INFORMATION_INTENTS as readonly string[]).includes(intent)) return null;
  if (!BLOG_INFORMATION_AUDIENCES.includes(audience as BlogInformationAudience)) return null;
  if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(locale)) return null;
  return {
    destinationId,
    intent: intent as BlogInformationIntent,
    audience: audience as BlogInformationAudience,
    locale,
  };
}

export function isCanonicalInformationSitemapPost(input: {
  slug: string;
  productId?: string | null;
  generationMeta?: Record<string, unknown> | null;
}): boolean {
  if (input.productId) return true;
  const representative = input.generationMeta?.information_representative;
  if (!representative || typeof representative !== 'object' || Array.isArray(representative)) return true;
  const record = representative as Record<string, unknown>;
  return record.status === 'active'
    && typeof record.canonical_slug === 'string'
    && record.canonical_slug === input.slug;
}

export function buildBlogInformationDuplicateDryRun(
  rows: BlogInformationDuplicateAuditRow[],
): BlogInformationDuplicateAuditGroup[] {
  const groups = new Map<string, BlogInformationDuplicateAuditRow[]>();
  for (const row of rows) {
    const key = buildBlogInformationRepresentativeKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map<BlogInformationDuplicateAuditGroup>(([representativeKey, members]) => {
    const sorted = [...members].sort((left, right) => {
      const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : Number.POSITIVE_INFINITY;
      const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : Number.POSITIVE_INFINITY;
      if (leftTime !== rightTime) return leftTime - rightTime;
      return left.slug.localeCompare(right.slug);
    });
    const canonicalSlug = sorted[0]?.slug ?? '';
    const duplicateSlugs = sorted.slice(1).map((row) => row.slug);
    return {
      representativeKey,
      canonicalSlug,
      duplicateSlugs,
      proposedAction: duplicateSlugs.length > 0 ? 'MERGE_REVIEW' : 'KEEP',
    };
  }).sort((left, right) => left.representativeKey.localeCompare(right.representativeKey));
}
