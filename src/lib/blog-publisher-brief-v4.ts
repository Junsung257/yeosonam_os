import { buildBlogContentBrief } from '@/lib/blog-content-brief';
import { BLOG_INFORMATION_RESEARCH_META_KEY } from '@/lib/blog-generation-research';

export function getQueueMicroAngleV4(item: any): string | null {
  const value = item?.meta?.micro_angle;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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

export function buildQueueContentBriefV4(item: any) {
  const queuedKeywords = Array.isArray(item.meta?.keywords) ? item.meta.keywords as string[] : [];
  return buildBlogContentBrief({
    topic: item.topic,
    destination: item.destination,
    primaryKeyword: item.primary_keyword || item.destination || item.topic.split(' ')[0],
    category: item.category,
    source: item.source,
    keywords: queuedKeywords,
    microAngle: getQueueMicroAngleV4(item),
    audience: typeof item.meta?.audience === 'string' ? item.meta.audience : null,
    locale: typeof item.meta?.locale === 'string' ? item.meta.locale : null,
    travelerNationality: typeof item.meta?.traveler_nationality === 'string' ? item.meta.traveler_nationality : null,
  });
}

export function queueMetaWithoutResearchBundleV4(meta: unknown): Record<string, unknown> {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  const safeMeta = { ...(meta as Record<string, unknown>) };
  delete safeMeta[BLOG_INFORMATION_RESEARCH_META_KEY];
  return safeMeta;
}
