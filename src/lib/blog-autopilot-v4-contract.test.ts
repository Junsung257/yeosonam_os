import { describe, expect, it } from 'vitest';
import {
  BLOG_QUALITY_DECISION_VERSION,
  buildBlogQualityDecisionV4,
  createBlogPipelineEventId,
  isBlogQualityDecisionPublishableV4,
  resolveBlogSearchLifecycleStatus,
  resolveProviderReceiptStatus,
  type BlogQualityDecisionV4,
} from './blog-autopilot-v4-contract';

function passingDecision(): BlogQualityDecisionV4 {
  const dimension = { score: 100, passed: true, issues: [], evaluatorVersion: 'test-v1' };
  return {
    version: BLOG_QUALITY_DECISION_VERSION,
    passed: true,
    modelVersion: 'recorded-deepseek-v4',
    promptVersion: 'blog-information-writer-v3',
    rubricVersion: 'blog-promptfoo-rubric-v4.0.0',
    claimHashBefore: 'same',
    claimHashAfter: 'same',
    deterministic: dimension,
    evidence: dimension,
    style: dimension,
    seo: dimension,
    publicRender: dimension,
    browserPreview: { ...dimension, score: 95 },
    decidedAt: '2026-09-01T00:00:00.000Z',
  };
}

describe('blog autopilot V4 contract', () => {
  it('separates provider receipt, crawl, indexing, and ranking', () => {
    expect(resolveBlogSearchLifecycleStatus({ requestStatus: 'requested' })).toBe('submitted');
    expect(resolveBlogSearchLifecycleStatus({ providerReceiptStatus: 'accepted' })).toBe('received');
    expect(resolveBlogSearchLifecycleStatus({ coverageState: '발견됨 - 현재 색인이 생성되지 않음' })).toBe('discovered');
    expect(resolveBlogSearchLifecycleStatus({ lastCrawlTime: '2026-09-01T00:00:00Z' })).toBe('crawled');
    expect(resolveBlogSearchLifecycleStatus({ indexStatus: 'indexed' })).toBe('indexed');
    expect(resolveBlogSearchLifecycleStatus({ indexStatus: 'indexed', bestRank: 7 })).toBe('ranking');
  });

  it('never treats a provider receipt as indexed', () => {
    expect(resolveProviderReceiptStatus({ requestStatus: 'requested', providerOk: true })).toBe('accepted');
    expect(resolveBlogSearchLifecycleStatus({
      requestStatus: 'requested',
      providerReceiptStatus: 'accepted',
    })).toBe('received');
  });

  it('builds a stable event id for the same queue and version', () => {
    const input = { queueId: 'A0000000-0000-4000-8000-000000000000', contentVersion: 'v4:1' };
    expect(createBlogPipelineEventId(input)).toBe(createBlogPipelineEventId(input));
    expect(createBlogPipelineEventId(input)).not.toBe(createBlogPipelineEventId({ ...input, contentVersion: 'v4:2' }));
  });

  it('requires claim preservation, 100-point deterministic gates, and a 95 browser preview', () => {
    expect(isBlogQualityDecisionPublishableV4(passingDecision())).toBe(true);
    expect(isBlogQualityDecisionPublishableV4({
      ...passingDecision(),
      claimHashAfter: 'changed',
    })).toBe(false);
    expect(isBlogQualityDecisionPublishableV4({
      ...passingDecision(),
      browserPreview: { ...passingDecision().browserPreview!, score: 94 },
    })).toBe(false);
  });

  it('builds split-dimension evidence without averaging away a hard failure', () => {
    const input = {
      modelVersion: 'recorded-deepseek-v4',
      promptVersion: 'blog-information-writer-v3',
      claimHashBefore: 'claims-v1',
      claimHashAfter: 'claims-v1',
      deterministicPassed: true,
      evidencePassed: true,
      stylePassed: true,
      seoPassed: true,
      publicRenderPassed: true,
      browserPreviewScore: 95,
      browserPreviewPassed: true,
    };
    expect(buildBlogQualityDecisionV4(input).passed).toBe(true);
    expect(buildBlogQualityDecisionV4({ ...input, evidencePassed: false }).passed).toBe(false);
  });
});
