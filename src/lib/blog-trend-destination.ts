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
}): string {
  const keyword = input.keyword.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const destination = input.destination.normalize('NFKC').replace(/\s+/g, ' ').trim();

  // Generic "destination travel" queries do not map to a publishable evidence
  // contract by themselves. Turn the live demand into the explicit preparation
  // intent supported by the information writer instead of an internal trend
  // analysis article that customers did not ask for.
  if (/여행(?:\s|$)/i.test(keyword)) {
    return `${keyword} 준비물 체크리스트와 출발 전 확인사항`;
  }
  return `${destination} ${keyword} 준비물 체크리스트와 최신 정보`;
}

export function buildBlogTrendCandidateMeta(topic: string): {
  expected_slug: string;
  micro_angle: 'preparation';
} {
  return {
    expected_slug: slugifyTopic(topic),
    micro_angle: 'preparation',
  };
}
import { slugifyTopic } from './slug-utils';
