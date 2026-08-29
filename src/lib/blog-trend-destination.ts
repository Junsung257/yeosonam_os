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

export function buildBlogTrendCandidateTopic(input: {
  keyword: string;
  destination: string;
  now?: Date;
}): string {
  const keyword = input.keyword.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const destination = input.destination.normalize('NFKC').replace(/\s+/g, ' ').trim();

  // Generic destination trends do not have a reviewed preparation-source
  // registry. Convert them into the nearest planning question backed by the
  // destination's reviewed WMO monthly-weather documents. Prefer an explicit
  // month in the keyword; otherwise help readers planning the next KST month.
  const explicitMonth = keyword.match(/(?:^|\s)(1[0-2]|[1-9])월(?:\s|$)/)?.[1];
  const month = explicitMonth
    ? Number(explicitMonth)
    : (Number(new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Seoul',
        month: 'numeric',
      }).format(input.now ?? new Date())) % 12) + 1;
  return `${destination} ${month}월 날씨와 옷차림 준비물 체크리스트`;
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
