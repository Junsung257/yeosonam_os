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
