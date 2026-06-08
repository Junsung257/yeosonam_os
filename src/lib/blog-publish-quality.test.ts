import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runQualityGates } from './blog-quality-gate';
import { computeReadability } from './blog-readability';
import { computeSeoScore } from './blog-seo-scorer';
import {
  applyBlogPublishQualityToUpdate,
  blogPublishQualityWarnings,
  evaluateBlogPublishQuality,
  resolveBlogDestination,
} from './blog-publish-quality';

vi.mock('./blog-quality-gate', () => ({
  runQualityGates: vi.fn(),
}));

vi.mock('./blog-readability', () => ({
  computeReadability: vi.fn(),
}));

vi.mock('./blog-seo-scorer', () => ({
  computeSeoScore: vi.fn(),
}));

const runQualityGatesMock = vi.mocked(runQualityGates);
const computeReadabilityMock = vi.mocked(computeReadability);
const computeSeoScoreMock = vi.mocked(computeSeoScore);

describe('blog publish quality', () => {
  beforeEach(() => {
    runQualityGatesMock.mockResolvedValue({
      passed: true,
      gates: [],
      summary: 'quality passed',
      checkedAt: '2026-06-09T00:00:00.000Z',
    });
    computeReadabilityMock.mockReturnValue({
      score: 88,
      sentence_count: 12,
      avg_sentence_len: 42,
      long_sentence_count: 0,
      double_negative_count: 0,
      duplicate_phrases: [],
      issues: [],
    });
    computeSeoScoreMock.mockReturnValue({
      score: 92,
      maxScore: 100,
      passed: true,
      details: [],
      summary: 'seo passed',
      checkedAt: '2026-06-09T00:00:00.000Z',
    });
  });

  it('blocks publishing when SEO fails even if render quality passes', async () => {
    computeSeoScoreMock.mockReturnValueOnce({
      score: 74,
      maxScore: 100,
      passed: false,
      details: [
        {
          name: 'image_seo',
          score: 2,
          maxScore: 8,
          status: 'fail',
          message: 'images 0, alt 0',
        },
      ],
      summary: 'SEO 74/100 publish blocked',
      checkedAt: '2026-06-09T00:00:00.000Z',
    });

    const report = await evaluateBlogPublishQuality({
      blog_html: '# Title\n\n본문입니다.\n\n![alt](https://example.com/a.jpg)',
      slug: 'test-post',
      seo_title: '테스트 글',
      seo_description: '테스트 설명',
      destination: '장가계',
    });

    expect(report.passed).toBe(false);
    expect(blogPublishQualityWarnings(report)).toEqual([
      { type: 'seo', gate: 'image_seo', reason: 'images 0, alt 0' },
    ]);
  });

  it('stores the four required evidence fields on updates', async () => {
    const report = await evaluateBlogPublishQuality({
      blog_html: '# Title\n\n본문입니다.',
      slug: 'test-post',
      seo_title: '테스트 글',
      seo_description: '테스트 설명',
    });
    const updateData: Record<string, unknown> = {};

    applyBlogPublishQualityToUpdate(updateData, report);

    expect(updateData).toMatchObject({
      quality_gate: report.qualityGate,
      seo_score: report.seoScore,
      readability_score: 88,
      readability_issues: [],
    });
  });

  it('resolves destination from joined travel package rows first', () => {
    expect(resolveBlogDestination({
      destination: 'fallback',
      travel_packages: [{ destination: '장가계' }],
    })).toBe('장가계');
  });
});
