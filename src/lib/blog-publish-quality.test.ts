import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runQualityGates } from './blog-quality-gate';
import { computeReadability } from './blog-readability';
import { computeSeoScore } from './blog-seo-scorer';
import {
  applyBlogPublishQualityToUpdate,
  blogPublishQualityWarnings,
  evaluateBlogPublicCustomerQuality,
  evaluateBlogPublishQuality,
  isBlogSeoDetailBlockingForPublish,
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
  it('keeps V3 keyword heuristics diagnostic while blocking indexing invariants', () => {
    expect(isBlogSeoDetailBlockingForPublish('semantic_longtail_coverage', true)).toBe(false);
    expect(isBlogSeoDetailBlockingForPublish('heading_structure', true)).toBe(false);
    expect(isBlogSeoDetailBlockingForPublish('information_freshness', true)).toBe(true);
    expect(isBlogSeoDetailBlockingForPublish('public_link_integrity', true)).toBe(true);
    expect(isBlogSeoDetailBlockingForPublish('semantic_longtail_coverage', false)).toBe(true);
  });

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

  it('uses the same HowTo extraction threshold as public JSON-LD', async () => {
    await evaluateBlogPublishQuality({
      blog_html: [
        '# Weather packing checklist',
        '',
        'Use a light layer and a compact rain shell for changing conditions.',
        '',
        '## Packing checklist',
        '',
        '- light layer',
        '- compact rain shell',
        '- waterproof pouch',
      ].join('\n'),
      slug: 'weather-packing-checklist',
      seo_title: 'Weather packing checklist',
      seo_description: 'A practical packing checklist for changing weather.',
      destination: 'Bali',
    });

    expect(computeSeoScoreMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        hasJsonLd: expect.objectContaining({
          faqPage: false,
          howTo: false,
        }),
      }),
    );
  });

  it('preserves the informational micro angle for duplicate scoping', async () => {
    await evaluateBlogPublishQuality({
      blog_html: '# 괌 공항 교통\n\n공식 근거를 비교합니다.',
      slug: 'guam-airport-transport',
      seo_title: '괌 공항 교통',
      seo_description: '괌 공항 교통 공식 근거를 비교합니다.',
      destination: '괌',
      angle_type: 'value',
      micro_angle: 'airport_arrival',
    });

    expect(runQualityGatesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        destination: '괌',
        angle_type: 'value',
        micro_angle: 'airport_arrival',
      }),
    );
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
    expect(blogPublishQualityWarnings(report)).toEqual(expect.arrayContaining([
      { type: 'seo', gate: 'image_seo', reason: 'images 0, alt 0' },
      expect.objectContaining({ type: 'quality', gate: 'public_customer_quality' }),
      expect.objectContaining({ type: 'public_customer_quality', gate: 'public_body_too_short' }),
    ]));
  });

  it('uses evidence and rendered contracts instead of the legacy SEO aggregate for V3', async () => {
    computeSeoScoreMock.mockReturnValueOnce({
      score: 82,
      maxScore: 100,
      passed: false,
      details: [{
        name: 'semantic_longtail_coverage',
        score: 3,
        maxScore: 8,
        status: 'fail',
        message: 'diagnostic coverage only',
      }],
      summary: 'legacy aggregate below 95',
      checkedAt: '2026-06-09T00:00:00.000Z',
    });
    const title = '다낭 가볼만한곳 선택 기준';
    const description = '다낭 가볼만한곳을 일정과 체력, 동행자의 우선순위에 맞춰 검증된 정보로 비교하는 선택 기준입니다.';
    const paragraphs = [
      '다낭 가볼만한곳은 장소 수보다 내 일정과 동행자의 우선순위를 먼저 정한 뒤 검증된 정보를 비교해 고릅니다.',
      '첫 번째 기준은 여행 중 이 선택에 쓸 수 있는 시간을 미리 정하는 것입니다.',
      '두 번째 기준은 동행자가 중요하게 생각하는 경험을 서로 확인하는 것입니다.',
      '세 번째 기준은 공식 근거에 나온 조건과 내 계획을 나란히 놓고 비교하는 것입니다.',
      '각 선택지의 검증된 문장은 출처 링크와 함께 읽고 추정 내용은 판단에서 제외합니다.',
      '서로 다른 우선순위가 있다면 모두 만족시키려 하지 말고 이번 일정의 핵심을 하나 정합니다.',
      '결정 뒤에는 남은 시간을 다른 일정에 어떻게 배분할지 동행자와 다시 확인합니다.',
      '이 과정을 거치면 확인된 정보의 범위 안에서 자신에게 맞는 선택을 설명할 수 있습니다.',
      '공식 출처와 연결된 문장은 판단 근거로 사용하고 출처가 없는 추정은 선택 기준에서 빼 둡니다.',
      '동행자의 답이 다르면 각자 포기하기 어려운 조건을 적어 공통으로 남는 선택지를 찾습니다.',
      '선택한 이유를 짧게 기록하면 일정이 바뀌어도 같은 기준으로 대안을 다시 고를 수 있습니다.',
      '마지막에는 확인된 조건과 개인적인 선호를 구분해 어느 부분이 사실이고 판단인지 살펴봅니다.',
      '모든 결정을 한 번에 끝내려 하지 말고 바뀔 수 있는 조건과 그대로 유지할 기준을 구분해 둡니다.',
    ];
    const report = await evaluateBlogPublishQuality({
      blog_html: `# ${title}\n\n${paragraphs.join('\n\n')}\n\n## 선택 질문\n\n- 이 공식 정보가 내 일정과 맞는가?\n- 이 수치를 내 우선순위와 비교하면 어떤 선택이 남는가?`,
      slug: 'danang-attractions-route-selector',
      seo_title: title,
      seo_description: description,
      destination: '다낭',
      generation_meta: {
        content_brief_v3: {
          metadata: { title, description },
          imageMinimum: 0,
        },
      },
    });

    expect(report.seoScore.passed).toBe(false);
    expect({
      passed: report.passed,
      qualityGate: report.qualityGate.passed,
      publicCustomer: report.publicCustomerQuality,
      renderedSeo: report.renderedSeoQuality,
    }).toMatchObject({
      passed: true,
      qualityGate: true,
      publicCustomer: { passed: true, score: 100, issues: [] },
      renderedSeo: { passed: true, issues: [] },
    });
  });

  it('blocks posts whose rendered public customer quality is below 95', async () => {
    const sections = Array.from(
      { length: 16 },
      (_, index) => `## 판단 기준 ${index + 1}\n\n여소남 운영팀 검증 문구 대신 독자가 확인할 조건을 설명합니다. `.repeat(3),
    ).join('\n\n');

    const report = await evaluateBlogPublishQuality({
      blog_html: `# 세부 여행 준비\n\n세부 여행 준비는 비용과 이동 조건부터 확인하면 됩니다.\n\n${sections}`,
      slug: 'cebu-public-customer-gate',
      seo_title: '세부 여행 준비 체크리스트',
      seo_description: '세부 여행 준비 비용과 이동 조건을 확인하는 체크리스트',
      destination: '세부',
    });

    expect(report.publicCustomerQuality.score).toBeLessThan(95);
    expect(report.qualityGate.gates).toContainEqual(
      expect.objectContaining({
        gate: 'public_customer_quality',
        passed: false,
      }),
    );
    expect(report.passed).toBe(false);
  });

  it('evaluates the normalized public body used by the customer page', async () => {
    const repeated =
      '동일한 긴 고객 문단은 공개 페이지에서 한 번만 보여야 하며 야간 품질 복구도 같은 화면을 평가해야 합니다.';
    const report = await evaluateBlogPublicCustomerQuality({
      blog_html: [
        '# 고객 화면 품질 가이드',
        '여행 준비는 일정, 비용, 이동 시간을 먼저 나눠 확인하면 판단이 쉬워집니다.',
        repeated,
        repeated,
        '출발 전에는 공식 안내와 예약 조건을 다시 확인하고 가족 구성에 맞춰 이동량을 조정하세요.',
        '첫날은 공항 도착 시각과 숙소 체크인 가능 시간을 함께 비교해 무리한 일정을 피하세요.',
        '현지 교통은 요금뿐 아니라 탑승 위치와 운영 종료 시각까지 확인해야 실제 이동에 도움이 됩니다.',
        '식비는 포함 식사와 개인 식사를 구분하고 결제 수단별 수수료를 따로 살펴보는 편이 정확합니다.',
        '준비물은 계절과 실내외 온도 차이를 기준으로 나누면 불필요한 짐을 줄일 수 있습니다.',
        '마지막 날에는 수하물 보관과 공항 이동 시간을 먼저 고정한 뒤 남는 시간에 일정을 배치하세요.',
        '공식 안내가 바뀔 수 있는 항목은 출발 직전에 다시 확인하고 확인 날짜를 함께 기록하세요.',
        '일행과 역할을 미리 나누면 예약 확인과 현지 결제 과정에서 빠뜨리는 항목을 줄일 수 있습니다.',
      ].join('\n\n'),
      slug: 'normalized-public-customer-view',
      seo_title: '고객 화면 품질 가이드',
      destination: '서울',
    });

    expect(report.issues.map((issue) => issue.code)).not.toContain('duplicate_public_section');
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

  it('does not invent customer decision blocks during deterministic publish preparation', async () => {
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

    expect(result.changes).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/product_consult_decision_blocks|engine_category_product_decision_blocks/),
    ]));
    expect(result.blogHtml).not.toContain('## 포함/불포함');
    expect(result.blogHtml).not.toContain('## 맞는 사람과 안 맞는 사람');
    expect(result.blogHtml).not.toContain('## 문의 전 질문');
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
