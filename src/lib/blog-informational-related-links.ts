import { inferCountryFromDestination } from './destination-iso';
import { getRegionForCity } from './regions';
import {
  BLOG_INFORMATION_INTENTS,
  type BlogInformationIntent,
} from './blog-information-contract';
import { readBlogInformationRepresentativeIdentity } from './blog-information-representative';
import type { BlogInformationAudience } from './blog-information-planner';

export interface BlogInformationalLinkContext {
  id?: string | null;
  slug: string;
  title?: string | null;
  destination?: string | null;
  destinationId: string;
  intent: BlogInformationIntent;
  audience: BlogInformationAudience;
  locale: string;
  contentType?: string | null;
  pillarFor?: string | null;
  clusterId?: string | null;
}

export interface BlogInformationalLinkCandidate extends BlogInformationalLinkContext {
  id: string;
  title: string;
  status: string | null;
  noindex?: boolean;
  redirectTo?: string | null;
  canonicalSlug?: string | null;
  publishedAt?: string | null;
}

export interface RankedBlogInformationalLink {
  candidate: BlogInformationalLinkCandidate;
  score: number;
  anchorText: string;
  reasons: string[];
}

const INTENT_NEIGHBORS: Record<BlogInformationIntent, ReadonlySet<BlogInformationIntent>> = {
  food_budget: new Set(['currency_payment', 'family_budget', 'hotel_areas', 'general']),
  monthly_weather: new Set(['itinerary', 'airport_transport', 'general']),
  airport_transport: new Set(['hotel_areas', 'itinerary', 'monthly_weather', 'general']),
  hotel_areas: new Set(['airport_transport', 'family_budget', 'itinerary', 'general']),
  family_budget: new Set(['food_budget', 'hotel_areas', 'currency_payment', 'itinerary', 'general']),
  itinerary: new Set(['family_budget', 'hotel_areas', 'airport_transport', 'monthly_weather', 'general']),
  shopping_souvenirs: new Set(['currency_payment', 'food_budget', 'entry_requirements', 'general']),
  entry_requirements: new Set(['travel_insurance', 'currency_payment', 'general']),
  travel_insurance: new Set(['entry_requirements', 'itinerary', 'general']),
  currency_payment: new Set(['food_budget', 'family_budget', 'entry_requirements', 'general']),
  general: new Set(BLOG_INFORMATION_INTENTS),
};

const INTENT_LABELS: Record<BlogInformationIntent, string> = {
  food_budget: '식비 가이드',
  monthly_weather: '월별 날씨',
  airport_transport: '공항 교통',
  hotel_areas: '숙소 지역',
  family_budget: '가족여행 예산',
  itinerary: '여행 일정',
  shopping_souvenirs: '쇼핑·기념품',
  entry_requirements: '입국 준비',
  travel_insurance: '여행자보험',
  currency_payment: '환전·결제',
  general: '여행 가이드',
};

const MIN_RELEVANCE_SCORE = 45;
const INFORMATION_AUDIENCES: ReadonlySet<BlogInformationAudience> = new Set([
  'general',
  'family',
  'couple',
  'solo',
  'senior',
  'student',
]);

function normalize(value?: string | null): string {
  return (value || '').trim().toLocaleLowerCase('ko-KR');
}

function normalizeAnchor(value: string): string {
  return value
    .replace(/\s*\|\s*여소남(?:\s*\d{4})?\s*$/g, '')
    .replace(/\b20\d{2}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sameEditorialCluster(
  source: BlogInformationalLinkContext,
  candidate: BlogInformationalLinkCandidate,
): boolean {
  if (source.clusterId && candidate.clusterId && source.clusterId === candidate.clusterId) return true;
  if (source.contentType === 'pillar' && candidate.pillarFor === source.destination) return true;
  if (candidate.contentType === 'pillar' && source.pillarFor === candidate.destination) return true;
  return Boolean(
    source.pillarFor
      && candidate.pillarFor
      && normalize(source.pillarFor) === normalize(candidate.pillarFor),
  );
}

function buildAnchor(
  candidate: BlogInformationalLinkCandidate,
  usedAnchors: Set<string>,
): string {
  const title = normalizeAnchor(candidate.title) || `${candidate.destination || candidate.destinationId} ${INTENT_LABELS[candidate.intent]}`;
  const destinationIntent = `${candidate.destination || candidate.destinationId} ${INTENT_LABELS[candidate.intent]}`.trim();
  const options = [
    title,
    destinationIntent,
    `${destinationIntent} 자세히 보기`,
    `${title} 핵심 정리`,
  ];

  for (const option of options) {
    const key = normalize(option);
    if (key && !usedAnchors.has(key)) {
      usedAnchors.add(key);
      return option;
    }
  }

  const fallback = `${destinationIntent} (${candidate.slug})`;
  usedAnchors.add(normalize(fallback));
  return fallback;
}

function isIndexableCandidate(candidate: BlogInformationalLinkCandidate): boolean {
  if (candidate.status !== 'published') return false;
  if (candidate.noindex || candidate.redirectTo) return false;
  if (candidate.canonicalSlug && candidate.canonicalSlug !== candidate.slug) return false;
  return true;
}

export function rankBlogInformationalRelatedLinks(
  source: BlogInformationalLinkContext,
  candidates: BlogInformationalLinkCandidate[],
  limit = 6,
): RankedBlogInformationalLink[] {
  if (limit <= 0) return [];

  const sourceDestination = normalize(source.destinationId || source.destination);
  const sourceCountry = inferCountryFromDestination(source.destination);
  const sourceRegion = getRegionForCity(source.destination)?.slug ?? null;
  const scored: Array<Omit<RankedBlogInformationalLink, 'anchorText'>> = [];
  const seenSlugs = new Set<string>();

  for (const candidate of candidates) {
    if (!candidate.slug || candidate.slug === source.slug || seenSlugs.has(candidate.slug)) continue;
    seenSlugs.add(candidate.slug);
    if (!isIndexableCandidate(candidate) || candidate.locale !== source.locale) continue;

    const reasons: string[] = [];
    let score = 0;
    const sameDestination = normalize(candidate.destinationId || candidate.destination) === sourceDestination;
    const sameIntent = candidate.intent === source.intent;
    const adjacentIntent = INTENT_NEIGHBORS[source.intent].has(candidate.intent);
    const candidateCountry = inferCountryFromDestination(candidate.destination);
    const candidateRegion = getRegionForCity(candidate.destination)?.slug ?? null;

    if (sameDestination && (sameIntent || adjacentIntent)) {
      score += sameIntent ? 120 : 100;
      reasons.push(sameIntent ? 'same_destination_same_intent' : 'same_destination_adjacent_intent');
    } else if (sameIntent && sourceCountry && candidateCountry === sourceCountry) {
      score += 80;
      reasons.push('same_country_same_intent');
    } else if (sameIntent && sourceRegion && candidateRegion === sourceRegion) {
      score += 65;
      reasons.push('same_region_same_intent');
    }

    if (
      source.audience !== 'general'
      && candidate.audience === source.audience
    ) {
      score += 45;
      reasons.push('same_specific_audience');
    }

    if (sameEditorialCluster(source, candidate)) {
      score += 45;
      reasons.push('editorial_pillar_cluster');
    }

    if (score < MIN_RELEVANCE_SCORE) continue;
    scored.push({ candidate, score, reasons });
  }

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const dateOrder = String(right.candidate.publishedAt || '').localeCompare(String(left.candidate.publishedAt || ''));
    if (dateOrder !== 0) return dateOrder;
    return left.candidate.slug.localeCompare(right.candidate.slug);
  });

  const usedAnchors = new Set<string>();
  return scored.slice(0, limit).map((entry) => ({
    ...entry,
    anchorText: buildAnchor(entry.candidate, usedAnchors),
  }));
}

function readNestedRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function readBlogInformationalLinkCandidate(input: {
  id: string;
  slug: string;
  title?: string | null;
  destination?: string | null;
  status?: string | null;
  contentType?: string | null;
  pillarFor?: string | null;
  targetAudience?: string | null;
  publishedAt?: string | null;
  generationMeta?: Record<string, unknown> | null;
}): BlogInformationalLinkCandidate | null {
  const identity = readBlogInformationRepresentativeIdentity(input.generationMeta);
  if (!identity) return null;

  const meta = input.generationMeta || {};
  const seo = readNestedRecord(meta.seo);
  const representative = readNestedRecord(meta.information_representative);
  const representativeStatus = typeof representative?.status === 'string'
    ? representative.status
    : null;
  const redirectTo = [meta.redirect_to, meta.redirectTo, meta.canonical_redirect_to]
    .find((value) => typeof value === 'string' && value.trim()) as string | undefined;
  const audience = INFORMATION_AUDIENCES.has(identity.audience)
    ? identity.audience
    : input.targetAudience;

  return {
    id: input.id,
    slug: input.slug,
    title: normalizeAnchor(input.title || '') || input.slug,
    destination: input.destination,
    destinationId: identity.destinationId,
    intent: identity.intent,
    audience: INFORMATION_AUDIENCES.has(audience as BlogInformationAudience)
      ? audience as BlogInformationAudience
      : 'general',
    locale: identity.locale,
    status: input.status ?? null,
    noindex:
      meta.noindex === true
      || seo?.noindex === true
      || (representativeStatus !== null && representativeStatus !== 'active'),
    redirectTo: redirectTo ?? null,
    canonicalSlug: typeof representative?.canonical_slug === 'string'
      ? representative.canonical_slug
      : null,
    contentType: input.contentType,
    pillarFor: input.pillarFor,
    clusterId: typeof meta.editorial_cluster_id === 'string' ? meta.editorial_cluster_id : null,
    publishedAt: input.publishedAt,
  };
}
