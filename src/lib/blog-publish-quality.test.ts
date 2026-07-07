import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runQualityGates } from './blog-quality-gate';
import { computeReadability } from './blog-readability';
import { computeSeoScore } from './blog-seo-scorer';
import {
  applyBlogPublishQualityToUpdate,
  blogPublishQualityWarnings,
  evaluateBlogPublishQuality,
  prepareBlogForPublish,
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
      {
        type: 'customer_quality',
        gate: 'customer.weak_answer_first',
        reason: '정보성 글은 첫 문단에서 고객 질문에 바로 답해야 합니다.',
      },
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

  it('audits product posts with the product quality contract', async () => {
    await evaluateBlogPublishQuality({
      blog_html: '# Product\n\nPackage body.',
      slug: 'danang-package-20260711',
      seo_title: '다낭 패키지',
      seo_description: '다낭 패키지 가격과 포함사항 안내',
      destination: '다낭',
      content_type: 'package_intro',
      product_id: 'pkg_123',
      primary_keyword: '다낭 패키지',
    });

    expect(runQualityGatesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        blog_type: 'product',
        content_type: 'package_intro',
        product_id: 'pkg_123',
      }),
    );
  });

  it('resolves destination from joined travel package rows first', () => {
    expect(resolveBlogDestination({
      destination: 'fallback',
      travel_packages: [{ destination: '장가계' }],
    })).toBe('장가계');
  });

  it('prepares thin info posts with readiness support and internal CTA evidence', async () => {
    const result = await prepareBlogForPublish({
      blog_html: [
        '# 세부 쇼핑 예산 선물 리스트와 면세점 체크',
        '',
        '세부 쇼핑 예산은 선물, 면세점, 현지 마트 가격을 나눠서 보면 판단이 쉽습니다. '.repeat(55),
        '',
        '## 예산 체크',
        '',
        '| 항목 | 확인 기준 |',
        '| --- | --- |',
        '| 선물 | 수량과 무게 |',
        '| 면세점 | 출국장 재고 |',
        '| 마트 | 결제 수단 |',
        '',
        '## 공식 확인',
        '',
        '- [외교부 해외안전여행](https://www.0404.go.kr/)',
        '- [인천국제공항](https://www.airport.kr/)',
      ].join('\n'),
      slug: 'cebu-shopping-budget-checklist',
      seo_title: '세부 쇼핑 예산 선물 리스트와 면세점 체크',
      seo_description: '세부 쇼핑 예산과 면세점 체크 기준',
      destination: '세부',
      content_type: 'guide',
      primary_keyword: '세부 쇼핑 예산',
    });

    expect(result.changes).toContain('appended_standard_internal_cta');
    expect(result.blogHtml).toContain('/packages?');
  });
});
