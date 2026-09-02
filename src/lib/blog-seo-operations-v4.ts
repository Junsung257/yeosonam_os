import { createHash } from 'node:crypto';

export const BLOG_SEO_AUDIT_VERSION_V4 = 'blog-seo-audit-v4.0.0' as const;

export type BlogSeoFindingCategoryV4 =
  | 'technical'
  | 'metadata_drift'
  | 'render_drift'
  | 'cannibalization'
  | 'content_decay'
  | 'gsc'
  | 'crux'
  | 'pagespeed'
  | 'source_adapter'
  | 'semantic_duplicate';

export type BlogSeoFindingV4 = {
  category: BlogSeoFindingCategoryV4;
  severity: 'info' | 'warning' | 'critical';
  code: string;
  action: 'none' | 'review' | 'repair_queue' | 'freeze';
  fingerprint: string;
  url?: string;
  slug?: string;
  evidence: Record<string, unknown>;
};

export type BlogSeoSurfaceObservationV4 = {
  url: string;
  slug: string;
  httpStatus: number | null;
  canonicalUrl: string | null;
  robotsDirective: string | null;
  title: string | null;
  description: string | null;
  h1Count: number;
  schemaTypes: string[];
  sitemapIncluded: boolean | null;
  renderHash: string;
  metadataHash: string;
};

export type BlogSearchMetricV4 = {
  slug: string;
  query: string;
  date: string;
  impressions: number | null;
  clicks: number | null;
  position: number | null;
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
}

function firstMatch(html: string, expression: RegExp): string | null {
  const match = expression.exec(html);
  return match?.[1] ? decodeHtml(match[1]) : null;
}

function metaContent(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return firstMatch(
    html,
    new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
  ) ?? firstMatch(
    html,
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, 'i'),
  );
}

function canonicalFromHtml(html: string): string | null {
  return firstMatch(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i)
    ?? firstMatch(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["'][^>]*>/i);
}

function schemaTypesFromHtml(html: string): string[] {
  const types = new Set<string>();
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const visit = (value: unknown) => {
        if (Array.isArray(value)) return value.forEach(visit);
        if (!value || typeof value !== 'object') return;
        const record = value as Record<string, unknown>;
        const type = record['@type'];
        if (typeof type === 'string') types.add(type);
        if (Array.isArray(type)) type.filter((item): item is string => typeof item === 'string').forEach((item) => types.add(item));
        Object.values(record).forEach(visit);
      };
      visit(JSON.parse(match[1]));
    } catch {
      types.add('InvalidJsonLd');
    }
  }
  return [...types].sort();
}

function normalizeRenderedText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--(?:.|\n|\r)*?-->/g, ' ')
    .replace(/\s(?:nonce|data-next-href|data-nextjs-scroll-focus-boundary)=["'][^"']*["']/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function inspectBlogSeoSurfaceV4(input: {
  url: string;
  slug: string;
  html: string;
  httpStatus: number | null;
  sitemapIncluded?: boolean | null;
}): BlogSeoSurfaceObservationV4 {
  const title = firstMatch(input.html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = metaContent(input.html, 'description');
  const robotsDirective = metaContent(input.html, 'robots');
  const canonicalUrl = canonicalFromHtml(input.html);
  const h1Count = (input.html.match(/<h1(?:\s|>)/gi) || []).length;
  const schemaTypes = schemaTypesFromHtml(input.html);
  const sitemapIncluded = input.sitemapIncluded ?? null;
  const metadata = JSON.stringify({
    title,
    description,
    canonicalUrl,
    robotsDirective,
    h1Count,
    schemaTypes,
    sitemapIncluded,
  });
  return {
    url: input.url,
    slug: input.slug,
    httpStatus: input.httpStatus,
    canonicalUrl,
    robotsDirective,
    title,
    description,
    h1Count,
    schemaTypes,
    sitemapIncluded,
    renderHash: sha256(normalizeRenderedText(input.html)),
    metadataHash: sha256(metadata),
  };
}

export function createBlogSeoFindingV4(input: Omit<BlogSeoFindingV4, 'fingerprint'>): BlogSeoFindingV4 {
  return {
    ...input,
    fingerprint: sha256(JSON.stringify({
      category: input.category,
      code: input.code,
      url: input.url ?? null,
      slug: input.slug ?? null,
      evidence: input.evidence,
    })),
  };
}

export function evaluateBlogSeoSurfaceV4(observation: BlogSeoSurfaceObservationV4): BlogSeoFindingV4[] {
  const base = { url: observation.url, slug: observation.slug };
  const findings: BlogSeoFindingV4[] = [];
  if (!observation.httpStatus || observation.httpStatus < 200 || observation.httpStatus >= 300) {
    findings.push(createBlogSeoFindingV4({ ...base, category: 'technical', severity: 'critical', code: 'public_http_not_success', action: 'freeze', evidence: { httpStatus: observation.httpStatus } }));
  }
  if (!observation.canonicalUrl) {
    findings.push(createBlogSeoFindingV4({ ...base, category: 'technical', severity: 'critical', code: 'canonical_missing', action: 'freeze', evidence: {} }));
  } else if (observation.canonicalUrl.replace(/\/$/, '') !== observation.url.replace(/\/$/, '')) {
    findings.push(createBlogSeoFindingV4({ ...base, category: 'technical', severity: 'critical', code: 'canonical_mismatch', action: 'freeze', evidence: { canonicalUrl: observation.canonicalUrl } }));
  }
  if (/\bnoindex\b/i.test(observation.robotsDirective || '')) {
    findings.push(createBlogSeoFindingV4({ ...base, category: 'technical', severity: 'critical', code: 'public_robots_noindex', action: 'freeze', evidence: { robotsDirective: observation.robotsDirective } }));
  }
  if (!observation.title || !observation.description) {
    findings.push(createBlogSeoFindingV4({ ...base, category: 'technical', severity: 'warning', code: 'metadata_incomplete', action: 'repair_queue', evidence: { title: Boolean(observation.title), description: Boolean(observation.description) } }));
  }
  if (observation.h1Count !== 1) {
    findings.push(createBlogSeoFindingV4({ ...base, category: 'technical', severity: 'critical', code: 'h1_contract_failed', action: 'freeze', evidence: { h1Count: observation.h1Count } }));
  }
  for (const required of ['Article', 'BreadcrumbList']) {
    if (!observation.schemaTypes.includes(required)) {
      findings.push(createBlogSeoFindingV4({ ...base, category: 'technical', severity: 'warning', code: `schema_${required.toLowerCase()}_missing`, action: 'repair_queue', evidence: { schemaTypes: observation.schemaTypes } }));
    }
  }
  if (observation.schemaTypes.includes('InvalidJsonLd')) {
    findings.push(createBlogSeoFindingV4({ ...base, category: 'technical', severity: 'critical', code: 'schema_json_invalid', action: 'freeze', evidence: {} }));
  }
  if (observation.sitemapIncluded === false) {
    findings.push(createBlogSeoFindingV4({ ...base, category: 'technical', severity: 'critical', code: 'sitemap_missing_public_url', action: 'freeze', evidence: {} }));
  }
  return findings;
}

export function detectBlogSeoDriftV4(
  current: BlogSeoSurfaceObservationV4,
  previous: BlogSeoSurfaceObservationV4 | null,
): BlogSeoFindingV4[] {
  if (!previous) return [];
  const base = { url: current.url, slug: current.slug };
  const findings: BlogSeoFindingV4[] = [];
  if (current.metadataHash !== previous.metadataHash) {
    findings.push(createBlogSeoFindingV4({ ...base, category: 'metadata_drift', severity: 'warning', code: 'metadata_contract_changed', action: 'review', evidence: { previous: previous.metadataHash, current: current.metadataHash } }));
  }
  if (current.renderHash !== previous.renderHash) {
    findings.push(createBlogSeoFindingV4({ ...base, category: 'render_drift', severity: 'info', code: 'public_render_changed', action: 'review', evidence: { previous: previous.renderHash, current: current.renderHash } }));
  }
  return findings;
}

function safeMetric(value: number | null): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function detectBlogCannibalizationV4(metrics: BlogSearchMetricV4[]): BlogSeoFindingV4[] {
  const byQuerySlug = new Map<string, { query: string; slug: string; impressions: number; clicks: number; weightedPosition: number; weight: number }>();
  for (const row of metrics) {
    const query = row.query.trim().toLocaleLowerCase('ko-KR');
    if (!query || query === '__page__' || !row.slug) continue;
    const key = `${query}\u0000${row.slug}`;
    const current = byQuerySlug.get(key) ?? { query, slug: row.slug, impressions: 0, clicks: 0, weightedPosition: 0, weight: 0 };
    const impressions = safeMetric(row.impressions);
    current.impressions += impressions;
    current.clicks += safeMetric(row.clicks);
    if (typeof row.position === 'number' && Number.isFinite(row.position)) {
      const weight = Math.max(1, impressions);
      current.weightedPosition += row.position * weight;
      current.weight += weight;
    }
    byQuerySlug.set(key, current);
  }
  const byQuery = new Map<string, Array<ReturnType<typeof aggregateSearchRow>>>();
  for (const row of byQuerySlug.values()) {
    const aggregate = aggregateSearchRow(row);
    if (aggregate.impressions < 10) continue;
    const rows = byQuery.get(aggregate.query) ?? [];
    rows.push(aggregate);
    byQuery.set(aggregate.query, rows);
  }
  const findings: BlogSeoFindingV4[] = [];
  for (const [query, rows] of byQuery) {
    if (rows.length < 2) continue;
    rows.sort((left, right) => right.impressions - left.impressions);
    const material = rows.filter((row) => row.avgPosition === null || row.avgPosition <= 20);
    if (material.length < 2) continue;
    const severe = material.slice(0, 2).every((row) => row.impressions >= 100);
    findings.push(createBlogSeoFindingV4({
      category: 'cannibalization',
      severity: severe ? 'critical' : 'warning',
      code: 'multiple_public_urls_compete_for_query',
      action: 'review',
      evidence: { query, candidates: material.slice(0, 5) },
    }));
  }
  return findings;
}

function aggregateSearchRow(row: { query: string; slug: string; impressions: number; clicks: number; weightedPosition: number; weight: number }) {
  return {
    query: row.query,
    slug: row.slug,
    impressions: row.impressions,
    clicks: row.clicks,
    avgPosition: row.weight > 0 ? Math.round((row.weightedPosition / row.weight) * 10) / 10 : null,
  };
}

export function detectBlogContentDecayV4(metrics: BlogSearchMetricV4[], now = new Date()): BlogSeoFindingV4[] {
  const currentStart = new Date(now.getTime() - 28 * 86_400_000);
  const previousStart = new Date(now.getTime() - 56 * 86_400_000);
  const totals = new Map<string, { recentImpressions: number; recentClicks: number; previousImpressions: number; previousClicks: number }>();
  for (const row of metrics) {
    if (!row.slug) continue;
    const date = new Date(`${row.date}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date < previousStart || date > now) continue;
    const total = totals.get(row.slug) ?? { recentImpressions: 0, recentClicks: 0, previousImpressions: 0, previousClicks: 0 };
    if (date >= currentStart) {
      total.recentImpressions += safeMetric(row.impressions);
      total.recentClicks += safeMetric(row.clicks);
    } else {
      total.previousImpressions += safeMetric(row.impressions);
      total.previousClicks += safeMetric(row.clicks);
    }
    totals.set(row.slug, total);
  }
  const findings: BlogSeoFindingV4[] = [];
  for (const [slug, total] of totals) {
    if (total.previousImpressions < 50 && total.previousClicks < 5) continue;
    const impressionRatio = total.previousImpressions > 0 ? total.recentImpressions / total.previousImpressions : 1;
    const clickRatio = total.previousClicks > 0 ? total.recentClicks / total.previousClicks : 1;
    if (impressionRatio >= 0.6 && clickRatio >= 0.6) continue;
    findings.push(createBlogSeoFindingV4({
      slug,
      category: 'content_decay',
      severity: impressionRatio < 0.4 || clickRatio < 0.4 ? 'critical' : 'warning',
      code: 'gsc_28d_material_decline',
      action: 'review',
      evidence: { ...total, impressionRatio, clickRatio },
    }));
  }
  return findings;
}

export function evaluateKoreanSemanticBenchmarkV4(input: { sampleSize: number; precision: number; recall: number }) {
  const issues = [
    ...(input.sampleSize < 100 ? ['sample_size_below_100'] : []),
    ...(input.precision < 0.9 ? ['precision_below_0_90'] : []),
    ...(input.recall < 0.9 ? ['recall_below_0_90'] : []),
  ];
  return { passed: issues.length === 0, issues };
}
