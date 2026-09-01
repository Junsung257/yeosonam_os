import { describe, expect, it } from 'vitest';
import {
  classifyBlogResearchSourceFormatV4,
  evaluateBlogResearchAdapterBenchmarkV4,
  extractWithCrawl4AiV4,
  extractWithDoclingV4,
  resolveBlogResearchAdapterCandidateV4,
} from './blog-research-source-adapters-v4';

const passingRow = {
  adapter: 'crawl4ai' as const,
  adapter_version: '0.9.0',
  sample_size: 30,
  extraction_success_count: 27,
  factual_fidelity_count: 30,
  ssrf_security_passed: true,
  latency_p95_ms: 30_000,
  passed: true,
};

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

  it('calls Crawl4AI only behind a recomputed passing benchmark and public URL gate', async () => {
    let request: RequestInit | undefined;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      request = init;
      return new Response(JSON.stringify([{ markdown: { raw_markdown: '# 공식 안내\n본문' }, metadata: { title: '공식 안내' } }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const result = await extractWithCrawl4AiV4({
      sourceUrl: 'https://example.com/dynamic', endpoint: 'https://crawl.internal.example', bearerToken: 'secret',
      benchmark: passingRow, fetchImpl,
    });
    expect(result.text).toContain('본문');
    expect(result.extractorVersion).toBe('crawl4ai:0.9.0');
    expect(request?.headers).toMatchObject({ authorization: 'Bearer secret' });
    await expect(extractWithCrawl4AiV4({
      sourceUrl: 'https://127.0.0.1/internal', endpoint: 'https://crawl.internal.example', bearerToken: 'secret',
      benchmark: passingRow, fetchImpl,
    })).rejects.toThrow('source_url_rejected');
  });

  it('calls Docling only for document formats behind its passing benchmark', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ document: { md_content: '# PDF\n숫자 100 보존' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
    const result = await extractWithDoclingV4({
      sourceUrl: 'https://example.com/guide.pdf', format: 'pdf', endpoint: 'https://docling.internal.example', apiKey: 'key',
      benchmark: { ...passingRow, adapter: 'docling' }, fetchImpl,
    });
    expect(result.text).toContain('숫자 100');
    expect(result.extractorVersion).toBe('docling:0.9.0');
    await expect(extractWithDoclingV4({
      sourceUrl: 'https://example.com/guide.pdf', format: 'pdf', endpoint: 'https://docling.internal.example',
      benchmark: { ...passingRow, adapter: 'docling', passed: false }, fetchImpl,
    })).rejects.toThrow('benchmark_gate_closed');
  });
});
