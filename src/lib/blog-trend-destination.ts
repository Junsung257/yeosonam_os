import { slugifyTopic } from './slug-utils';

function normalizeDestination(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  return normalized || null;
}

export function buildSupportedBlogTrendDestinations(input: {
  activeCatalogDestinations: Array<string | null | undefined>;
  publishedBlogDestinations: Array<string | null | undefined>;
}): Set<string> {
  return new Set(
    [...input.activeCatalogDestinations, ...input.publishedBlogDestinations]
      .map(normalizeDestination)
      .filter((destination): destination is string => Boolean(destination)),
  );
}

export function isSupportedBlogTrendDestination(
  destination: string | null | undefined,
  supportedDestinations: ReadonlySet<string>,
): boolean {
  const normalized = normalizeDestination(destination);
  return normalized != null && supportedDestinations.has(normalized);
}

export function buildClaimedMonthlyWeatherTrendDestinations(
  rows: Array<{
    destination_id?: string | null;
    intent?: string | null;
    audience?: string | null;
    locale?: string | null;
    status?: string | null;
  }>,
): Set<string> {
  return new Set(rows
    .filter((row) => row.intent === 'monthly_weather'
      && row.audience === 'general'
      && row.locale === 'ko-KR'
      && row.status === 'active')
    .map((row) => normalizeDestination(row.destination_id))
    .filter((destination): destination is string => Boolean(destination)));
}

export function buildBlogTrendCandidateTopic(input: {
  keyword: string;
  destination: string;
  now?: Date;
}): string {
  const destination = input.destination.normalize('NFKC').replace(/\s+/g, ' ').trim();

  // Generic destination trends do not have a reviewed preparation-source
  // registry. Convert them into the one canonical 1-12 month weather guide
  // allowed by the informational representative contract. Seasonal wording
  // belongs inside that representative; it must not create a second URL.
  return `${destination} 월별 날씨와 옷차림 준비물 체크리스트`;
}

export function buildBlogTrendCandidateMeta(topic: string): {
  expected_slug: string;
  micro_angle: 'weather_packing';
} {
  return {
    expected_slug: slugifyTopic(topic),
    micro_angle: 'weather_packing',
  };
}
