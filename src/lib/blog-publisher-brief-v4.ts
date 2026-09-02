import { buildBlogContentBrief } from '@/lib/blog-content-brief';
import { BLOG_INFORMATION_RESEARCH_META_KEY } from '@/lib/blog-generation-research';
import {
  readProgrammaticAudience,
  readProgrammaticMicroAngle,
} from '@/lib/blog-programmatic-contract';
import type { BlogInformationAudience } from '@/lib/blog-information-planner';

interface BlogPublisherQueueItemV4 {
  topic: string;
  destination?: string | null;
  primary_keyword?: string | null;
  category?: string | null;
  angle_type?: string | null;
  source?: string | null;
  meta?: Record<string, unknown> | null;
}

const BLOG_INFORMATION_AUDIENCES: ReadonlySet<string> = new Set([
  'general',
  'family',
  'couple',
  'solo',
  'senior',
  'student',
]);

function isBlogInformationAudience(value: unknown): value is BlogInformationAudience {
  return typeof value === 'string' && BLOG_INFORMATION_AUDIENCES.has(value);
}

export function getQueueMicroAngleV4(item: BlogPublisherQueueItemV4): string | null {
  return readProgrammaticMicroAngle({ meta: item.meta, angleType: item.angle_type });
}

export function microAngleForInformationIntentV4(intent: unknown): string | null {
  const normalized = typeof intent === 'string' ? intent.trim() : '';
  return ({
    food_budget: 'food_budget', monthly_weather: 'weather_packing', airport_transport: 'airport_arrival',
    local_transport: 'transport_cost', hotel_areas: 'hotel_area', family_budget: 'budget_family',
    itinerary: 'itinerary', shopping_souvenirs: 'shopping_souvenirs', currency_payment: 'currency_payment',
    entry_requirements: 'entry_requirements', travel_insurance: 'travel_insurance',
  } as Record<string, string>)[normalized] ?? null;
}

export function buildQueueContentBriefV4(item: BlogPublisherQueueItemV4) {
  const meta = item.meta;
  const queuedKeywords = Array.isArray(meta?.keywords)
    ? meta.keywords.filter((value): value is string => typeof value === 'string')
    : [];
  return buildBlogContentBrief({
    topic: item.topic,
    destination: item.destination,
    primaryKeyword: item.primary_keyword || item.destination || item.topic.split(' ')[0],
    category: item.category,
    source: item.source,
    keywords: queuedKeywords,
    microAngle: getQueueMicroAngleV4(item),
    audience: isBlogInformationAudience(meta?.audience)
      ? meta.audience
      : readProgrammaticAudience({ meta, angleType: item.angle_type }),
    locale: typeof meta?.locale === 'string' ? meta.locale : null,
    travelerNationality: typeof meta?.traveler_nationality === 'string' ? meta.traveler_nationality : null,
  });
}

export function queueMetaWithoutResearchBundleV4(meta: unknown): Record<string, unknown> {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  const safeMeta = { ...(meta as Record<string, unknown>) };
  delete safeMeta[BLOG_INFORMATION_RESEARCH_META_KEY];
  return safeMeta;
}
