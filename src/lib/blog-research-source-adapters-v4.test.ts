import { describe, expect, it } from 'vitest';
import {
  classifyBlogResearchSourceFormatV4,
  evaluateBlogResearchAdapterBenchmarkV4,
  resolveBlogResearchAdapterCandidateV4,
} from './blog-research-source-adapters-v4';

describe('blog research source adapter V4 contract', () => {
  it('routes HTML, structured text, PDF, and office documents deterministically', () => {
    expect(classifyBlogResearchSourceFormatV4({ contentType: 'text/html; charset=utf-8' })).toBe('html');
    expect(classifyBlogResearchSourceFormatV4({ contentType: 'application/json' })).toBe('structured_text');
    expect(classifyBlogResearchSourceFormatV4({ contentType: '', url: 'https://example.com/guide.pdf' })).toBe('pdf');
    expect(classifyBlogResearchSourceFormatV4({
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      url: 'https://example.com/guide.docx',
    })).toBe('office_document');
  });

  it('requires the full 30-source, 90%, 100%, SSRF, and p95 benchmark', () => {
    const passing = {
      sampleSize: 30,
      extractionSuccessCount: 27,
      factualFidelityCount: 30,
      ssrfSecurityPassed: true,
      latencyP95Ms: 30_000,
    };
    expect(evaluateBlogResearchAdapterBenchmarkV4(passing).passed).toBe(true);
    expect(resolveBlogResearchAdapterCandidateV4({
      format: 'html', currentExtractionFailed: true, benchmark: passing,
    })).toBe('crawl4ai');
    expect(resolveBlogResearchAdapterCandidateV4({
      format: 'office_document', currentExtractionFailed: true, benchmark: passing,
    })).toBe('docling');
    expect(evaluateBlogResearchAdapterBenchmarkV4({ ...passing, factualFidelityCount: 29 }).passed).toBe(false);
  });

  it('keeps the current engine first and rejects unbenchmarked fallbacks', () => {
    expect(resolveBlogResearchAdapterCandidateV4({ format: 'html', currentExtractionFailed: false })).toBe('current');
    expect(resolveBlogResearchAdapterCandidateV4({ format: 'html', currentExtractionFailed: true })).toBe('reject');
  });
});
