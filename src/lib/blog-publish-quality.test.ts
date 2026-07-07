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

  it('stores engine v2 critic and evidence pack metadata on updates', async () => {
    runQualityGatesMock.mockResolvedValueOnce({
      passed: true,
      gates: [
        {
          gate: 'engine_v2',
          passed: true,
          evidence: {
            evaluation: {
              score: 100,
              passed: true,
              failure_bucket: 'passed',
              metrics: {
                task_completion: 100,
                naturalness: 100,
                faithfulness: 100,
                source_support: 100,
                sales_pressure: 100,
                product_decision_helpfulness: 100,
              },
              repair_recommendation: null,
              publish_threshold: 95,
              brief: {
                writer_type: 'info_writer',
                reader_task: '검색 의도 해결',
                primary_keyword: '발리 준비물',
                destination: '발리',
                evidence_items: [{ kind: 'official_source', label: 'official', url: 'https://example.com' }],
                cta_policy: 'bottom_soft',
                forbidden_claims: [],
              },
              evidence_pack: {
                engine_version: 'blog-engine-v2',
                writer_type: 'info_writer',
                items: [{ kind: 'official_source', label: 'official', url: 'https://example.com' }],
                official_source_count: 1,
                internal_insight_count: 0,
                product_db_count: 0,
                serp_intent_count: 0,
                score: 100,
                sufficient: true,
                missing: [],
              },
            },
          },
        },
      ],
      summary: 'quality passed',
      checkedAt: '2026-06-09T00:00:00.000Z',
    });

    const report = await evaluateBlogPublishQuality({
      blog_html: '# 발리 준비물\n\n발리 준비물은 날씨와 이동 기준으로 확인합니다.',
      slug: 'bali-packing',
      seo_title: '발리 준비물',
      seo_description: '발리 준비물 체크',
      destination: '발리',
      primary_keyword: '발리 준비물',
    });
    const updateData: Record<string, unknown> = {};

    applyBlogPublishQualityToUpdate(updateData, report);

    expect(updateData.generation_meta).toMatchObject({
      engine_version: 'blog-engine-v2',
      writer: 'info_writer',
      brief_score: 100,
      evidence_score: 100,
      critic_score: 100,
      engine_score: 100,
      failure_bucket: 'passed',
      evidence_pack: expect.objectContaining({
        sufficient: true,
        official_source_count: 1,
      }),
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

  it('repairs engine v2 critic failures before returning prepared publish output', async () => {
    const engineGate = {
      gate: 'engine_v2' as const,
      passed: false,
      reason: 'engine v2 95/100: engine_task_incomplete',
      evidence: {
        evaluation: {
          score: 95,
          passed: false,
          failure_bucket: 'engine_task_incomplete',
          metrics: {
            task_completion: 80,
            naturalness: 100,
            faithfulness: 100,
            source_support: 100,
            sales_pressure: 100,
            product_decision_helpfulness: 100,
          },
          repair_recommendation: '도입 답변 수리',
          publish_threshold: 95,
          brief: {
            writer_type: 'info_writer',
            reader_task: '검색 의도 해결',
            primary_keyword: '몽골 7월 날씨',
            destination: '몽골',
            evidence_items: [{ kind: 'official_source', label: 'official', url: 'https://www.0404.go.kr/' }],
            cta_policy: 'bottom_soft',
            forbidden_claims: [],
            official_sources_required: true,
          },
          evidence_pack: {
            engine_version: 'blog-engine-v2',
            writer_type: 'info_writer',
            items: [{ kind: 'official_source', label: 'official', url: 'https://www.0404.go.kr/' }],
            official_source_count: 1,
            internal_insight_count: 0,
            product_db_count: 0,
            serp_intent_count: 0,
            score: 100,
            sufficient: true,
            missing: [],
          },
        },
      },
    };
    runQualityGatesMock
      .mockResolvedValueOnce({
        passed: false,
        gates: [engineGate],
        summary: 'engine failed',
        checkedAt: '2026-06-09T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        passed: true,
        gates: [{
          ...engineGate,
          passed: true,
          reason: undefined,
          evidence: {
            evaluation: {
              ...(engineGate.evidence.evaluation),
              score: 100,
              passed: true,
              failure_bucket: 'passed',
              metrics: {
                ...(engineGate.evidence.evaluation.metrics),
                task_completion: 100,
              },
            },
          },
        }],
        summary: 'quality passed',
        checkedAt: '2026-06-09T00:00:00.000Z',
      });

    const result = await prepareBlogForPublish({
      blog_html: [
        '# 몽골 7월 날씨',
        '',
        '몽골 7월 날씨은 먼저 한눈에 보기 기준으로 확인하면 됩니다.',
        '',
        '| 항목 | 확인 기준 | 준비 |',
        '| --- | --- | --- |',
        '| 낮 | 기온 | 긴팔 |',
        '| 밤 | 일교차 | 겉옷 |',
        '| 비 | 소나기 | 방수팩 |',
        '',
        '[외교부 해외안전여행](https://www.0404.go.kr/)',
      ].join('\n'),
      slug: 'mongolia-weather-packing',
      seo_title: '몽골 7월 날씨',
      seo_description: '몽골 7월 날씨와 옷차림',
      destination: '몽골',
      content_type: 'guide',
      primary_keyword: '몽골 7월 날씨',
      generation_meta: {
        writer: 'info_writer',
        info_guide_brief: { official_sources_required: true },
        content_brief: { search_intent: 'weather' },
      },
    });

    expect(result.changes).toContain('engine_v2_answer_first_intro');
    expect(result.report.passed).toBe(true);
  });
});
