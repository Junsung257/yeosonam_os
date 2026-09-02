export const BLOG_PAGESPEED_CONTRACT_VERSION_V4 = 'blog-pagespeed-v4.0.0' as const;
export const BLOG_PAGESPEED_THRESHOLDS_V4 = Object.freeze({
  inpMs: 200,
  lcpMs: 2_500,
  cls: 0.1,
  performanceScore: 90,
});

type PsiMetric = { percentile?: number; category?: string };
type PsiMetrics = {
  INTERACTION_TO_NEXT_PAINT?: PsiMetric;
  LARGEST_CONTENTFUL_PAINT_MS?: PsiMetric;
  CUMULATIVE_LAYOUT_SHIFT_SCORE?: PsiMetric;
  FIRST_CONTENTFUL_PAINT_MS?: PsiMetric;
  EXPERIMENTAL_TIME_TO_FIRST_BYTE?: PsiMetric;
};

export type BlogPageSpeedPayloadV4 = {
  id?: string;
  loadingExperience?: { metrics?: PsiMetrics };
  originLoadingExperience?: { metrics?: PsiMetrics };
  lighthouseResult?: { categories?: { performance?: { score?: number } } };
  analysisUTCTimestamp?: string;
};

export type BlogPageSpeedObservationV4 = {
  contractVersion: typeof BLOG_PAGESPEED_CONTRACT_VERSION_V4;
  url: string;
  strategy: 'mobile';
  fieldSource: 'url' | 'origin' | 'none';
  inpMs: number | null;
  lcpMs: number | null;
  cls: number | null;
  fcpMs: number | null;
  ttfbMs: number | null;
  performanceScore: number | null;
  analyzedAt: string;
  receipt: {
    responseId: string | null;
    analysisUTCTimestamp: string | null;
    metricCategories: Record<string, string | null>;
  };
};

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function parseBlogPageSpeedPayloadV4(url: string, payload: BlogPageSpeedPayloadV4): BlogPageSpeedObservationV4 {
  const urlMetrics = payload.loadingExperience?.metrics;
  const originMetrics = payload.originLoadingExperience?.metrics;
  const metrics = urlMetrics && Object.keys(urlMetrics).length > 0 ? urlMetrics : originMetrics;
  const fieldSource = metrics === urlMetrics ? 'url' : metrics === originMetrics && metrics ? 'origin' : 'none';
  const clsPercentile = finite(metrics?.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile);
  const performance = finite(payload.lighthouseResult?.categories?.performance?.score);
  return {
    contractVersion: BLOG_PAGESPEED_CONTRACT_VERSION_V4,
    url,
    strategy: 'mobile',
    fieldSource,
    inpMs: finite(metrics?.INTERACTION_TO_NEXT_PAINT?.percentile),
    lcpMs: finite(metrics?.LARGEST_CONTENTFUL_PAINT_MS?.percentile),
    cls: clsPercentile === null ? null : clsPercentile / 100,
    fcpMs: finite(metrics?.FIRST_CONTENTFUL_PAINT_MS?.percentile),
    ttfbMs: finite(metrics?.EXPERIMENTAL_TIME_TO_FIRST_BYTE?.percentile),
    performanceScore: performance === null ? null : Math.round(performance * 100),
    analyzedAt: new Date().toISOString(),
    receipt: {
      responseId: typeof payload.id === 'string' ? payload.id : null,
      analysisUTCTimestamp: typeof payload.analysisUTCTimestamp === 'string' ? payload.analysisUTCTimestamp : null,
      metricCategories: Object.fromEntries(Object.entries(metrics || {}).map(([key, value]) => [key, value?.category ?? null])),
    },
  };
}

export async function fetchBlogPageSpeedObservationV4(input: {
  url: string;
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<BlogPageSpeedObservationV4> {
  const params = new URLSearchParams({ url: input.url, strategy: 'mobile', category: 'performance' });
  if (input.apiKey) params.set('key', input.apiKey);
  const response = await (input.fetchImpl ?? fetch)(
    `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`,
    {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(input.timeoutMs ?? 60_000),
    },
  );
  if (!response.ok) throw new Error(`pagespeed_http_${response.status}`);
  return parseBlogPageSpeedPayloadV4(input.url, await response.json() as BlogPageSpeedPayloadV4);
}

export function evaluateBlogPageSpeedObservationV4(observation: BlogPageSpeedObservationV4): string[] {
  return [
    ...(observation.fieldSource === 'none' ? ['crux_field_data_missing'] : []),
    ...(observation.inpMs !== null && observation.inpMs > BLOG_PAGESPEED_THRESHOLDS_V4.inpMs ? ['crux_inp_above_200ms'] : []),
    ...(observation.lcpMs !== null && observation.lcpMs > BLOG_PAGESPEED_THRESHOLDS_V4.lcpMs ? ['crux_lcp_above_2500ms'] : []),
    ...(observation.cls !== null && observation.cls > BLOG_PAGESPEED_THRESHOLDS_V4.cls ? ['crux_cls_above_0_1'] : []),
    ...(observation.performanceScore !== null && observation.performanceScore < BLOG_PAGESPEED_THRESHOLDS_V4.performanceScore
      ? ['pagespeed_performance_below_90'] : []),
  ];
}
