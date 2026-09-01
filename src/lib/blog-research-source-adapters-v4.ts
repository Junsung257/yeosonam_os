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
