export const BLOG_RESEARCH_ADAPTER_CONTRACT_VERSION = 'blog-research-source-adapters-v4.0.0' as const;

export type BlogResearchSourceFormatV4 = 'html' | 'structured_text' | 'pdf' | 'office_document' | 'unsupported';

export type BlogResearchSourceCandidateV4 = {
  url: string;
  sourceKey: string;
  expectedFormat?: BlogResearchSourceFormatV4;
};

export type BlogResearchFetchedSourceV4 = {
  url: string;
  contentType: string;
  body: Uint8Array;
  fetchedAt: string;
};

export type BlogResearchExtractedSourceV4 = {
  url: string;
  title: string;
  text: string;
  format: BlogResearchSourceFormatV4;
  extractorVersion: string;
};

export type BlogResearchSourceSnapshotV4 = BlogResearchExtractedSourceV4 & {
  contentHash: string;
  capturedAt: string;
};

export type BlogResearchSourceClaimV4 = {
  claimText: string;
  sourceLocator: string;
  normalizedValue?: string;
  unit?: string;
};

/**
 * Source collectors are swappable only behind this complete evidence lifecycle.
 * An adapter may not return public claims directly from an unversioned response.
 */
export interface BlogResearchSourceAdapterV4 {
  readonly id: string;
  readonly contractVersion: typeof BLOG_RESEARCH_ADAPTER_CONTRACT_VERSION;
  discover(query: string): Promise<BlogResearchSourceCandidateV4[]>;
  fetch(candidate: BlogResearchSourceCandidateV4): Promise<BlogResearchFetchedSourceV4>;
  extract(source: BlogResearchFetchedSourceV4): Promise<BlogResearchExtractedSourceV4>;
  snapshot(source: BlogResearchExtractedSourceV4): Promise<BlogResearchSourceSnapshotV4>;
  claims(snapshot: BlogResearchSourceSnapshotV4): Promise<BlogResearchSourceClaimV4[]>;
}

export function classifyBlogResearchSourceFormatV4(input: {
  contentType: string | null | undefined;
  url?: string | null;
}): BlogResearchSourceFormatV4 {
  const contentType = String(input.contentType || '').toLowerCase();
  const pathname = (() => {
    try { return new URL(String(input.url || '')).pathname.toLowerCase(); } catch { return ''; }
  })();
  if (contentType.includes('application/pdf') || pathname.endsWith('.pdf')) return 'pdf';
  if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) return 'html';
  if (contentType.includes('application/json')
    || contentType.includes('application/xml')
    || contentType.includes('text/xml')
    || contentType.includes('text/plain')) return 'structured_text';
  if (/\.(?:docx?|xlsx?|pptx?)$/.test(pathname)
    || /application\/(?:vnd\.|msword)/.test(contentType)) return 'office_document';
  return 'unsupported';
}

export type BlogResearchAdapterBenchmarkV4 = {
  sampleSize: number;
  extractionSuccessCount: number;
  factualFidelityCount: number;
  ssrfSecurityPassed: boolean;
  latencyP95Ms: number;
};

export const BLOG_RESEARCH_ADAPTER_ACTIVATION_THRESHOLDS_V4 = Object.freeze({
  minimumSampleSize: 30,
  minimumExtractionSuccessRate: 0.9,
  requiredFactualFidelityRate: 1,
  maximumLatencyP95Ms: 30_000,
});

export function evaluateBlogResearchAdapterBenchmarkV4(input: BlogResearchAdapterBenchmarkV4) {
  const sampleSize = Math.max(0, Math.trunc(input.sampleSize));
  const extractionSuccessRate = sampleSize > 0 ? input.extractionSuccessCount / sampleSize : 0;
  const factualFidelityRate = sampleSize > 0 ? input.factualFidelityCount / sampleSize : 0;
  const issues = [
    ...(sampleSize < BLOG_RESEARCH_ADAPTER_ACTIVATION_THRESHOLDS_V4.minimumSampleSize ? ['sample_size_below_30'] : []),
    ...(extractionSuccessRate < BLOG_RESEARCH_ADAPTER_ACTIVATION_THRESHOLDS_V4.minimumExtractionSuccessRate
      ? ['extraction_success_below_0_90'] : []),
    ...(factualFidelityRate < BLOG_RESEARCH_ADAPTER_ACTIVATION_THRESHOLDS_V4.requiredFactualFidelityRate
      ? ['numeric_date_claim_fidelity_below_1_00'] : []),
    ...(!input.ssrfSecurityPassed ? ['ssrf_security_failed'] : []),
    ...(input.latencyP95Ms > BLOG_RESEARCH_ADAPTER_ACTIVATION_THRESHOLDS_V4.maximumLatencyP95Ms
      ? ['latency_p95_above_30s'] : []),
  ];
  return {
    passed: issues.length === 0,
    extractionSuccessRate,
    factualFidelityRate,
    issues,
  };
}

export function resolveBlogResearchAdapterCandidateV4(input: {
  format: BlogResearchSourceFormatV4;
  currentExtractionFailed: boolean;
  benchmark?: BlogResearchAdapterBenchmarkV4 | null;
}): 'current' | 'crawl4ai' | 'docling' | 'reject' {
  if (!input.currentExtractionFailed && ['html', 'structured_text', 'pdf'].includes(input.format)) return 'current';
  if (!input.benchmark || !evaluateBlogResearchAdapterBenchmarkV4(input.benchmark).passed) return 'reject';
  if (input.format === 'html') return 'crawl4ai';
  if (input.format === 'pdf' || input.format === 'office_document') return 'docling';
  return 'reject';
}

export type BlogExternalAdapterIdV4 = 'crawl4ai' | 'docling';

export type BlogExternalAdapterBenchmarkRowV4 = {
  adapter: BlogExternalAdapterIdV4;
  adapter_version: string;
  sample_size: number;
  extraction_success_count: number | null;
  factual_fidelity_count: number | null;
  ssrf_security_passed: boolean | null;
  latency_p95_ms: number | null;
  passed: boolean;
};

export function isExternalAdapterBenchmarkPassingV4(row: BlogExternalAdapterBenchmarkRowV4 | null): boolean {
  if (!row) return false;
  return row.passed && evaluateBlogResearchAdapterBenchmarkV4({
    sampleSize: row.sample_size,
    extractionSuccessCount: Number(row.extraction_success_count || 0),
    factualFidelityCount: Number(row.factual_fidelity_count || 0),
    ssrfSecurityPassed: row.ssrf_security_passed === true,
    latencyP95Ms: Number(row.latency_p95_ms ?? Number.POSITIVE_INFINITY),
  }).passed;
}

function externalServiceUrl(endpoint: string, pathname: string): string {
  const base = new URL(endpoint);
  const local = base.hostname === 'localhost' || base.hostname === '127.0.0.1';
  if (base.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && local && base.protocol === 'http:')) {
    throw new Error('blog_external_adapter_https_endpoint_required');
  }
  if (base.username || base.password || base.search || base.hash) throw new Error('blog_external_adapter_endpoint_invalid');
  return new URL(pathname.replace(/^\//, ''), `${base.toString().replace(/\/$/, '')}/`).toString();
}

function findText(value: unknown, preferredKeys: readonly string[]): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findText(item, preferredKeys);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  for (const key of preferredKeys) {
    const found = findText(record[key], preferredKeys);
    if (found) return found;
  }
  for (const nested of Object.values(record)) {
    if (!nested || typeof nested !== 'object') continue;
    const found = findText(nested, preferredKeys);
    if (found) return found;
  }
  return null;
}

export async function extractWithCrawl4AiV4(input: {
  sourceUrl: string;
  endpoint: string;
  bearerToken: string;
  benchmark: BlogExternalAdapterBenchmarkRowV4 | null;
  fetchImpl?: typeof fetch;
}): Promise<BlogResearchExtractedSourceV4> {
  const { isSafePublicBlogSourceUrl } = await import('@/lib/blog-official-source-url');
  if (!isSafePublicBlogSourceUrl(input.sourceUrl)) throw new Error('blog_crawl4ai_source_url_rejected');
  if (!input.bearerToken.trim()) throw new Error('blog_crawl4ai_token_missing');
  if (!isExternalAdapterBenchmarkPassingV4(input.benchmark) || input.benchmark?.adapter !== 'crawl4ai') {
    throw new Error('blog_crawl4ai_benchmark_gate_closed');
  }
  const response = await (input.fetchImpl ?? fetch)(externalServiceUrl(input.endpoint, '/crawl'), {
    method: 'POST',
    headers: { authorization: `Bearer ${input.bearerToken}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      urls: [input.sourceUrl],
      browser_config: { type: 'BrowserConfig', params: { headless: true } },
      crawler_config: { type: 'CrawlerRunConfig', params: { stream: false, cache_mode: 'bypass' } },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`blog_crawl4ai_http_${response.status}`);
  const payload = await response.json() as unknown;
  const text = findText(payload, ['markdown', 'fit_markdown', 'raw_markdown', 'content', 'text']);
  if (!text) throw new Error('blog_crawl4ai_empty_extraction');
  return {
    url: input.sourceUrl,
    title: findText(payload, ['title']) || new URL(input.sourceUrl).hostname,
    text,
    format: 'html',
    extractorVersion: `crawl4ai:${input.benchmark.adapter_version}`,
  };
}

export async function extractWithDoclingV4(input: {
  sourceUrl: string;
  format: 'pdf' | 'office_document';
  endpoint: string;
  apiKey?: string | null;
  benchmark: BlogExternalAdapterBenchmarkRowV4 | null;
  fetchImpl?: typeof fetch;
}): Promise<BlogResearchExtractedSourceV4> {
  const { isSafePublicBlogSourceUrl } = await import('@/lib/blog-official-source-url');
  if (!isSafePublicBlogSourceUrl(input.sourceUrl)) throw new Error('blog_docling_source_url_rejected');
  if (!isExternalAdapterBenchmarkPassingV4(input.benchmark) || input.benchmark?.adapter !== 'docling') {
    throw new Error('blog_docling_benchmark_gate_closed');
  }
  const response = await (input.fetchImpl ?? fetch)(externalServiceUrl(input.endpoint, '/v1/convert/source'), {
    method: 'POST',
    headers: {
      ...(input.apiKey ? { 'x-api-key': input.apiKey } : {}),
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ http_sources: [{ url: input.sourceUrl }], options: { to_formats: ['md'] } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`blog_docling_http_${response.status}`);
  const payload = await response.json() as unknown;
  const text = findText(payload, ['md_content', 'markdown', 'content', 'text']);
  if (!text) throw new Error('blog_docling_empty_extraction');
  return {
    url: input.sourceUrl,
    title: findText(payload, ['title', 'filename']) || new URL(input.sourceUrl).pathname.split('/').pop() || new URL(input.sourceUrl).hostname,
    text,
    format: input.format,
    extractorVersion: `docling:${input.benchmark.adapter_version}`,
  };
}
