import { buildBlogContentBrief } from './blog-content-brief';
import {
  type BlogResearchOfficialDocumentCapability,
  type BlogResearchRegistryCapability,
  type BlogResearchReputableCapability,
  hasReviewedBlogResearchCoverage,
} from './blog-research-capability';
import { buildBlogInformationRepresentativeKey } from './blog-information-representative';
import type { BlogInformationAudience } from './blog-information-planner';
import { slugifyTopic } from './slug-utils';

export const BLOG_PROGRAMMATIC_CONTRACT_VERSION = 1;

export interface BlogProgrammaticContractSpec {
  microAngle: string;
  audience: BlogInformationAudience;
  category: string;
}

const PROGRAMMATIC_CONTRACTS: Readonly<Record<string, BlogProgrammaticContractSpec>> = {
  weather: { microAngle: 'weather_packing', audience: 'general', category: 'preparation' },
  itinerary_3d: { microAngle: 'itinerary', audience: 'general', category: 'itinerary' },
  itinerary_5d: { microAngle: 'itinerary', audience: 'general', category: 'itinerary' },
  food: { microAngle: 'food_budget', audience: 'general', category: 'food' },
  visa: { microAngle: 'entry_requirements', audience: 'general', category: 'entry_requirements' },
  transport: { microAngle: 'airport_arrival', audience: 'general', category: 'transport' },
  currency: { microAngle: 'currency_payment', audience: 'general', category: 'currency' },
  season_best: { microAngle: 'weather_packing', audience: 'general', category: 'preparation' },
  family: { microAngle: 'kid_friendly', audience: 'family', category: 'itinerary' },
  honeymoon: { microAngle: 'itinerary', audience: 'couple', category: 'itinerary' },
  filial: { microAngle: 'itinerary', audience: 'senior', category: 'itinerary' },
};

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function programmaticAngle(meta: unknown, angleType?: string | null): string | null {
  const record = meta && typeof meta === 'object' && !Array.isArray(meta)
    ? meta as Record<string, unknown>
    : null;
  const explicit = cleanString(record?.programmatic_angle);
  if (explicit) return explicit;
  const isProgrammatic = Boolean(record?.programmatic_source_id ?? record?.pseo_topic_id);
  return isProgrammatic ? cleanString(angleType) : null;
}

export function getBlogProgrammaticContract(
  angle: unknown,
): BlogProgrammaticContractSpec | null {
  const normalized = cleanString(angle)?.toLowerCase();
  return normalized ? PROGRAMMATIC_CONTRACTS[normalized] ?? null : null;
}

export function readProgrammaticMicroAngle(input: {
  meta?: unknown;
  angleType?: string | null;
}): string | null {
  const record = input.meta && typeof input.meta === 'object' && !Array.isArray(input.meta)
    ? input.meta as Record<string, unknown>
    : null;
  return cleanString(record?.micro_angle)
    ?? getBlogProgrammaticContract(programmaticAngle(input.meta, input.angleType))?.microAngle
    ?? null;
}

export function readProgrammaticAudience(input: {
  meta?: unknown;
  angleType?: string | null;
}): BlogInformationAudience | null {
  const record = input.meta && typeof input.meta === 'object' && !Array.isArray(input.meta)
    ? input.meta as Record<string, unknown>
    : null;
  const explicit = cleanString(record?.audience);
  if (explicit && ['general', 'family', 'couple', 'solo', 'senior', 'student'].includes(explicit)) {
    return explicit as BlogInformationAudience;
  }
  return getBlogProgrammaticContract(programmaticAngle(input.meta, input.angleType))?.audience ?? null;
}

export function readProgrammaticExpectedSlug(input: {
  meta?: unknown;
  topic?: string | null;
}): string | null {
  const record = input.meta && typeof input.meta === 'object' && !Array.isArray(input.meta)
    ? input.meta as Record<string, unknown>
    : null;
  const explicit = cleanString(record?.expected_slug) ?? cleanString(record?.spun_slug);
  if (explicit) return explicit.toLowerCase();
  const isProgrammatic = Boolean(
    record?.programmatic_source_id
    ?? record?.pseo_topic_id
    ?? record?.programmatic_angle,
  );
  const topic = cleanString(input.topic);
  if (!isProgrammatic || !topic) return null;
  return slugifyTopic(topic) || null;
}

export function buildProgrammaticQueueMeta(input: {
  sourceId: string;
  angle: string;
  topic: string;
  month?: number | null;
  existing?: Record<string, unknown> | null;
}): Record<string, unknown> | null {
  const contract = getBlogProgrammaticContract(input.angle);
  const expectedSlug = slugifyTopic(input.topic);
  if (!contract || !expectedSlug) return null;
  return {
    ...(input.existing ?? {}),
    programmatic_source_id: input.sourceId,
    programmatic_angle: input.angle,
    programmatic_month: input.month ?? null,
    programmatic_contract_version: BLOG_PROGRAMMATIC_CONTRACT_VERSION,
    micro_angle: contract.microAngle,
    audience: contract.audience,
    expected_slug: expectedSlug,
  };
}

export type BlogProgrammaticPromotionRejection =
  | 'contract_invalid'
  | 'human_review_required'
  | 'research_coverage_missing'
  | 'active_representative_exists';

export function evaluateProgrammaticPromotionReadiness(input: {
  topic: string;
  destination: string;
  primaryKeyword: string;
  category: string;
  source: string;
  angleType: string;
  meta: Record<string, unknown>;
  activeRepresentativeKeys: ReadonlySet<string>;
  registries: BlogResearchRegistryCapability[];
  officialDocuments: BlogResearchOfficialDocumentCapability[];
  reputableSources: BlogResearchReputableCapability[];
}): {
  passed: boolean;
  reason: BlogProgrammaticPromotionRejection | null;
  representativeKey: string | null;
} {
  const brief = buildBlogContentBrief({
    topic: input.topic,
    destination: input.destination,
    primaryKeyword: input.primaryKeyword,
    category: input.category,
    source: input.source,
    microAngle: readProgrammaticMicroAngle({ meta: input.meta, angleType: input.angleType }),
    audience: readProgrammaticAudience({ meta: input.meta, angleType: input.angleType }),
    locale: typeof input.meta.locale === 'string' ? input.meta.locale : 'ko-KR',
    travelerNationality: typeof input.meta.traveler_nationality === 'string'
      ? input.meta.traveler_nationality
      : null,
  });
  if (!brief.passed || brief.intentType === 'general' || !brief.plan.destinationId) {
    return { passed: false, reason: 'contract_invalid', representativeKey: null };
  }
  if (brief.requiresHumanReview) {
    return { passed: false, reason: 'human_review_required', representativeKey: null };
  }
  if (!hasReviewedBlogResearchCoverage({
    intent: brief.intentType,
    destination: input.destination,
    allowedSourceTypes: brief.sourcePolicy.sourceTypes,
    registries: input.registries,
    officialDocuments: input.officialDocuments,
    reputableSources: input.reputableSources,
  })) {
    return { passed: false, reason: 'research_coverage_missing', representativeKey: null };
  }
  const representativeKey = buildBlogInformationRepresentativeKey({
    destinationId: brief.plan.destinationId,
    intent: brief.intentType,
    audience: brief.plan.audience,
    locale: brief.plan.locale,
  });
  if (input.activeRepresentativeKeys.has(representativeKey)) {
    return { passed: false, reason: 'active_representative_exists', representativeKey };
  }
  return { passed: true, reason: null, representativeKey };
}
