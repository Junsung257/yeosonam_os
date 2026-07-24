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

  it.each([
    'deterministic_info_fallback',
    'deterministic_fast_fallback',
  ])('blocks %s artifacts even when every scored gate passes', async (fallbackFlag) => {
    const report = await evaluateBlogPublishQuality({
      blog_html: '# 다낭 여행 준비\n\n다낭 여행 준비에 필요한 내용을 정리했습니다.',
      slug: 'danang-travel-guide',
      seo_title: '다낭 여행 준비 가이드',
      seo_description: '다낭 여행 준비에 필요한 핵심 정보',
      destination: '다낭',
      generation_meta: { [fallbackFlag]: true },
    });

    expect(report.passed).toBe(false);
    expect(report.publishContractIssues).toEqual([
      expect.objectContaining({
        code: 'deterministic_info_fallback_not_publishable',
        evidence: { fallbackFlags: [fallbackFlag] },
      }),
    ]);
    expect(blogPublishQualityWarnings(report)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'publish_contract',
          gate: 'deterministic_info_fallback_not_publishable',
        }),
      ]),
    );
  });

  it('stores publish evidence and the rendered reading-time SSOT on updates', async () => {
    const report = await evaluateBlogPublishQuality({
      blog_html: '# Title\n\n본문입니다.',
      slug: 'test-post',
      seo_title: '테스트 글',
      seo_description: '테스트 설명',
    });
    const updateData: Record<string, unknown> = {};

    applyBlogPublishQualityToUpdate(updateData, report);

    expect(updateData).toMatchObject({
      quality_gate: {
        ...report.qualityGate,
        rendered_reading_time_minutes: report.readingTimeMinutes,
      },
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
    expect(computeSeoScoreMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ hasRenderedPageH1: true }),
    );
  });

  it('resolves destination from joined travel package rows first', () => {
    expect(resolveBlogDestination({
      destination: 'fallback',
      travel_packages: [{ destination: '장가계' }],
    })).toBe('장가계');
  });

  it('prepares thin info posts while leaving CTA delivery to the runtime hub', async () => {
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

    expect(result.changes).not.toContain('appended_standard_internal_cta');
    expect(result.blogHtml).not.toContain('/packages?');
  });

  it('prepares weak product posts with customer decision blocks before final evaluation', async () => {
    const result = await prepareBlogForPublish({
      blog_html: [
        '# 다낭 패키지',
        '',
        '다낭 패키지를 간단히 비교해 보세요.',
      ].join('\n'),
      slug: 'danang-package-value',
      seo_title: '부산출발 다낭 3박5일 패키지',
      seo_description: '다낭 패키지 가격과 포함 항목 안내',
      destination: '다낭',
      content_type: 'package_intro',
      product_id: 'pkg_123',
      primary_keyword: '다낭 패키지',
      generation_meta: {
        product_consult_brief: {
          price_from: 579000,
          departure_city: '부산/김해',
          duration: '3박5일',
          included: ['왕복 항공', '호텔'],
          excluded: ['개인경비'],
          fit_for: ['부산 출발 가족 패키지를 비교하는 분'],
          not_fit_for: ['자유일정 중심 여행을 원하는 분'],
          risk_notes: ['항공 좌석과 객실 가능 여부에 따라 가격 변동'],
          consult_questions: ['출발일과 인원은 어떻게 되나요?'],
        },
      },
    });

    expect(result.changes).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/product_consult_decision_blocks|engine_category_product_decision_blocks/),
      ]),
    );
    expect(result.blogHtml).toContain('## 포함/불포함');
    expect(result.blogHtml).toContain('## 맞는 사람과 안 맞는 사람');
    expect(result.blogHtml).toContain('## 문의 전 질문');
  });

  it('keeps a verified body unchanged for metadata-only republishing and uses the brief keyword', async () => {
    const blogHtml = [
      '# 괌 7월 날씨',
      '',
      '1~12월 기온과 강수량을 확인하세요.',
      '',
      '## 공식 출처',
      '',
      '[세계기상기구](https://worldweather.wmo.int/)',
    ].join('\n');

    const result = await prepareBlogForPublish({
      blog_html: blogHtml,
      slug: 'guam-weather-packing',
      seo_title: '괌 7월 날씨 옷차림 여행 준비물 체크리스트',
      seo_description: '괌 7월 날씨와 옷차림 준비물을 공식 기후 자료로 확인하세요.',
      destination: '괌',
      primary_keyword: '잘못 전달된 전체 제목',
      generation_meta: {
        content_brief: {
          primary_keyword: '괌 7월 날씨',
        },
      },
      preserveBody: true,
    });

    expect(result).toMatchObject({
      blogHtml,
      changed: false,
      changes: ['preserved_verified_body_for_metadata_update'],
    });
    expect(runQualityGatesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ primary_keyword: '괌 7월 날씨' }),
    );
    expect(computeSeoScoreMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ primaryKeyword: '괌 7월 날씨' }),
    );
  });
});
