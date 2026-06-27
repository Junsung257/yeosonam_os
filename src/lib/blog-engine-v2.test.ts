import { describe, expect, it } from 'vitest';
import { buildBlogEngineV2Brief, evaluateBlogEngineV2 } from './blog-engine-v2';

describe('blog engine v2 evaluation', () => {
  it('passes an evidence-backed informational post with bottom-soft CTA', () => {
    const blogHtml = `# 발리 가족 여행 경비

발리 가족 여행 경비는 항공, 숙소, 현지 이동비를 먼저 나눠 보면 됩니다. 3인 가족이라면 성수기 항공권과 리조트 위치가 총액 차이를 가장 크게 만듭니다.

## 비용 판단표
| 항목 | 확인 기준 | 메모 |
| --- | --- | --- |
| 항공 | 출발일 | 성수기 변동 |
| 숙소 | 지역 | 이동비 차이 |
| 식비 | 동선 | 리조트 포함 여부 |

## 공식 확인
[인도네시아 입국 정보](https://kemlu.go.id)

## 내 일정 기준으로 확인하기
마지막에는 내 일정과 인원 기준으로 가능 여부만 확인하세요.
`;

    const evaluation = evaluateBlogEngineV2({
      blogHtml,
      primaryKeyword: '발리 가족 여행 경비',
      destination: '발리',
      generationMeta: {
        writer: 'info_writer',
        info_guide_brief: {
          reader_question: '발리 가족 여행 경비는 얼마인가요?',
          answer_first: '항공, 숙소, 현지 이동비를 먼저 나눠 보면 됩니다.',
          official_sources_required: true,
        },
        content_brief: {
          search_intent: 'cost',
          evidence: ['검색자는 3인 가족 기준 총액을 궁금해한다.'],
        },
      },
    });

    expect(evaluation.passed).toBe(true);
    expect(evaluation.score).toBeGreaterThanOrEqual(80);
    expect(evaluation.brief.evidence_items.some((item) => item.kind === 'official_source')).toBe(true);
  });

  it('blocks informational posts without evidence', () => {
    const evaluation = evaluateBlogEngineV2({
      blogHtml: `# 다낭 준비물

다낭 준비물은 날씨와 숙소 위치를 기준으로 먼저 확인하면 됩니다. 우기에는 방수 준비, 카드, 현금, 상비약을 나눠 챙기세요.

## 체크리스트
- 여권
- 카드
- 현금
- 상비약
- 방수팩
`,
      primaryKeyword: '다낭 준비물',
      destination: '다낭',
      generationMeta: { writer: 'info_writer' },
    });

    expect(evaluation.passed).toBe(false);
    expect(evaluation.failure_bucket).toBe('evidence_insufficient');
  });

  it('passes product consultant posts only when DB-backed decision blocks exist', () => {
    const blogHtml = `# 발리 4박5일 패키지: 899,000원부터, 이런 분께 맞습니다

인천 출발 발리 4박5일 상품을 보고 있다면 포함사항과 일정 체감을 먼저 확인하세요.

## 10초 판단
| 확인 항목 | 현재 기준 | 문의 전 볼 점 |
| --- | --- | --- |
| 가격 | 899,000원부터 | 출발일별 확인 |
| 기간 | 4박5일 | 이동 부담 확인 |
| 포함 | 항공/호텔 | 불포함 확인 |

## 포함/불포함
| 구분 | 항목 | 확인 포인트 |
| --- | --- | --- |
| 포함 | 항공 | 상담 확인 |
| 포함 | 호텔 | 상담 확인 |
| 불포함 | 개인경비 | 상담 확인 |

## 이런 분께 맞습니다
- 가족 패키지를 가격과 일정 기준으로 비교하려는 고객

## 이런 분께는 맞지 않을 수 있습니다
- 자유일정 비중이 큰 여행을 원하는 고객

## 가격이 달라질 수 있는 조건
- 가격과 좌석은 발권 시점에 달라질 수 있음

## 문의 전 질문
- 인원과 출발 가능일이 어떻게 되나요?
`;
    const evaluation = evaluateBlogEngineV2({
      blogHtml,
      primaryKeyword: '발리 패키지',
      destination: '발리',
      contentType: 'package_intro',
      productId: 'pkg_123',
      generationMeta: {
        writer: 'product_consultant_writer',
        product_consult_brief: {
          price_from: 899000,
          departure_city: '인천',
          duration: '4박5일',
          included: ['항공', '호텔'],
          excluded: ['개인경비'],
          fit_for: ['가족 패키지 비교 고객'],
          not_fit_for: ['자유일정 선호 고객'],
          risk_notes: ['가격과 좌석은 달라질 수 있음'],
          consult_questions: ['인원과 출발 가능일이 어떻게 되나요?'],
        },
      },
    });

    expect(evaluation.passed).toBe(true);
    expect(evaluation.metrics.product_decision_helpfulness).toBe(100);
  });

  it('builds the public V2 brief shape from generation meta', () => {
    const brief = buildBlogEngineV2Brief({
      blogHtml: '[공식](https://example.com)',
      primaryKeyword: '발리 패키지',
      destination: '발리',
      contentType: 'package_intro',
      productId: 'pkg_123',
      generationMeta: {
        writer: 'product_consultant_writer',
        product_consult_brief: {
          included: ['항공'],
          excluded: ['개인경비'],
          fit_for: ['가족'],
          not_fit_for: ['자유여행'],
          risk_notes: ['가격 변동'],
          consult_questions: ['출발 가능일?'],
        },
      },
    });

    expect(brief).toMatchObject({
      writer_type: 'product_consultant_writer',
      primary_keyword: '발리 패키지',
      destination: '발리',
      cta_policy: 'product_consult',
      product_id: 'pkg_123',
    });
    expect(brief.evidence_items.some((item) => item.kind === 'product_db')).toBe(true);
  });
});
