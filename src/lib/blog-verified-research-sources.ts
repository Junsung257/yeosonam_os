import { isSafePublicBlogSourceUrl } from './blog-official-source-url';

export const BLOG_RESEARCH_PREFLIGHT_VERSION = 'r18-research-first-v1';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Reads only the compact source handoff produced after the server-managed
 * research readiness gate has passed. Claim publication still runs its
 * registry-backed evidence gate separately.
 */
export function readVerifiedResearchOfficialSourceUrls(
  generationMeta: unknown,
): string[] {
  const meta = asRecord(generationMeta);
  const preflight = asRecord(meta.information_research_preflight);
  if (
    preflight.version !== BLOG_RESEARCH_PREFLIGHT_VERSION
    || preflight.passed !== true
    || !Array.isArray(preflight.official_source_urls)
  ) return [];

  return [...new Set(
    preflight.official_source_urls
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) =>
        value.length > 0
        && !/yeosonam\.com/i.test(value)
        && isSafePublicBlogSourceUrl(value)),
  )].slice(0, 12);
}
