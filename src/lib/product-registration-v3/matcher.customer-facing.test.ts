import { describe, expect, it } from 'vitest';

import { applyProductRegistrationV3Matching } from './matcher';
import type { V3DraftLedger } from './types';

function attractionLedger(rawText: string): V3DraftLedger {
  return {
    document: {
      type: 'single_package',
      expected_products: 1,
      variant_axes: [],
    },
    variants: [{
      variant_key: 'base',
      grade: null,
      course: null,
      duration_days: 1,
      nights: 0,
      title_parts: [],
      price_calendar: [],
      flight_segments: [],
      days: [{
        day: 1,
        route: [],
        events: [{
          type: 'attraction',
          time: null,
          raw_text: rawText,
          canonical_id: null,
          canonical_type: null,
          match_status: 'unmatched',
          evidence: {
            line_start: 1,
            line_end: 1,
            char_start: 0,
            char_end: rawText.length,
            quote: rawText,
          },
        }],
        meals: { breakfast: {}, lunch: {}, dinner: {} },
        hotel: {},
      }],
      inclusions: [],
      exclusions: [],
      options: [],
      shopping: [],
      structured_facts: [],
      standard_notices: [],
      minimum_departure: null,
      evidence_coverage: {},
    }],
  };
}

describe('product registration V3 attraction recognition', () => {
  it('matches a valid active master even when its rich customer card is not publishable', () => {
    const result = applyProductRegistrationV3Matching(
      attractionLedger('검수전 전망대'),
      [{
        id: 'private-attraction',
        name: '검수전 전망대',
        is_active: true,
        customer_publishable: false,
      }],
      '테스트',
    );

    expect(result.matchSummary.attraction_matched_count).toBe(1);
    expect(result.matchSummary.attraction_unmatched_count).toBe(0);
  });

  it('matches the same active master after it is explicitly customer publishable', () => {
    const result = applyProductRegistrationV3Matching(
      attractionLedger('검수전 전망대'),
      [{
        id: 'public-attraction',
        name: '검수전 전망대',
        is_active: true,
        customer_publishable: true,
      }],
      '테스트',
    );

    expect(result.matchSummary.attraction_matched_count).toBe(1);
    expect(result.matchSummary.attraction_unmatched_count).toBe(0);
  });

  it('does not recognize a product-like row as an attraction master', () => {
    const result = applyProductRegistrationV3Matching(
      attractionLedger('통천협 관광'),
      [{
        id: 'product-row',
        name: '[한국어 가이드] 통천협 당일 투어 입장권 포함',
        is_active: true,
        customer_publishable: false,
        category: 'sightseeing',
      }],
      '석가장',
    );

    expect(result.matchSummary.attraction_matched_count).toBe(0);
    expect(result.matchSummary.attraction_unmatched_count).toBe(1);
  });

  it.each([
    '↓ 추천선택관광',
    '▶ 홍콩데이투어($180/인) : 8인부터',
  ])('does not queue a complete option disclosure or its heading: %s', rawText => {
    const ledger = attractionLedger(rawText);
    ledger.variants[0].days[0].events[0].type = 'option';

    const result = applyProductRegistrationV3Matching(ledger, [], '홍콩');

    expect(result.matchSummary.option_review_count).toBe(0);
  });

  it('uses a unique exact public name when the supplier destination label is noisy', () => {
    const result = applyProductRegistrationV3Matching(
      attractionLedger('화려한 색감을 자랑하는 린푸억사원'),
      [{
        id: 'linh-phuoc',
        name: '린푸억사원',
        region: '달랏',
        is_active: true,
        customer_publishable: true,
      }],
      '나트랑/달랏 품격 노팁',
    );

    expect(result.matchSummary.attraction_matched_count).toBe(1);
    expect(result.matchSummary.attraction_unmatched_count).toBe(0);
  });

  it('extracts a public landmark name before a supplier description dash', () => {
    const result = applyProductRegistrationV3Matching(
      attractionLedger('도이수텝 사원 – 전망이 아름다운 황금사원'),
      [{
        id: 'doi-suthep',
        name: '도이수텝 사원',
        region: '치앙마이',
        is_active: true,
        customer_publishable: true,
      }],
      '노옵션 치앙마이 핫플레이스',
    );

    expect(result.matchSummary.attraction_matched_count).toBe(1);
    expect(result.matchSummary.attraction_unmatched_count).toBe(0);
  });

  it('does not use a polluted alias as an unscoped public fallback', () => {
    const result = applyProductRegistrationV3Matching(
      attractionLedger('라오허제 야시장'),
      [{
        id: 'polluted-market',
        name: '달랏야시장',
        aliases: ['라오허제 야시장'],
        region: null,
        is_active: true,
        customer_publishable: true,
      }],
      '타이페이/예스지',
    );

    expect(result.matchSummary.attraction_matched_count).toBe(0);
    expect(result.matchSummary.attraction_unmatched_count).toBe(1);
  });

  it('matches one unique public canonical name inside a supplier description', () => {
    const result = applyProductRegistrationV3Matching(
      attractionLedger('소원을 비는 스펀 마을 천등(풍등) 소원 날리기 (4인1 大)'),
      [{
        id: 'shifen',
        name: '스펀',
        region: '타이베이',
        is_active: true,
        customer_publishable: true,
      }],
      '타이페이/예스지',
    );

    expect(result.matchSummary.attraction_matched_count).toBe(1);
    expect(result.matchSummary.attraction_unmatched_count).toBe(0);
  });

  it('maps high-confidence supplier descriptions only to existing public masters', () => {
    const result = applyProductRegistrationV3Matching(
      attractionLedger('마카오 상징적 건축물로 유명한 성바울 성당'),
      [{
        id: 'st-paul',
        name: '성바울성당유적',
        region: '마카오',
        is_active: true,
        customer_publishable: true,
      }],
      '마카오',
    );

    expect(result.matchSummary.attraction_matched_count).toBe(1);
    expect(result.matchSummary.attraction_unmatched_count).toBe(0);
    expect(result.ledger.variants[0].days[0].events[0].canonical_id).toBe('st-paul');
  });

  it('uses a high-confidence description hint for an active internal master', () => {
    const result = applyProductRegistrationV3Matching(
      attractionLedger('팔천협 관광'),
      [{
        id: 'private-eight-springs',
        name: '팔천협풍경구',
        region: '태항산',
        is_active: true,
        customer_publishable: false,
      }],
      '태항산',
    );

    expect(result.matchSummary.attraction_matched_count).toBe(1);
    expect(result.matchSummary.attraction_unmatched_count).toBe(0);
  });

  it('does not match a short canonical name embedded inside a different Korean word', () => {
    const result = applyProductRegistrationV3Matching(
      attractionLedger('화산지형의 독특한 지질풍경 압록강 대협곡'),
      [{
        id: 'huashan',
        name: '화산',
        region: '서안',
        is_active: true,
        customer_publishable: true,
      }],
      '백두산',
    );

    expect(result.matchSummary.attraction_matched_count).toBe(0);
    expect(result.matchSummary.attraction_unmatched_count).toBe(1);
  });

  it('does not queue a golf-course selection line as an attraction', () => {
    const result = applyProductRegistrationV3Matching(
      attractionLedger('츠키샷프/ 클라크/ 기타히로시마/ 유니토부 18홀 中 1 곳 / 셀프플레이'),
      [],
      '삿포로',
    );

    expect(result.matchSummary.attraction_matched_count).toBe(0);
    expect(result.matchSummary.attraction_unmatched_count).toBe(0);
  });

  it.each([
    '12일, 17일, 19일, 24일, 26일',
    '북파+서파',
    'REMARKS',
    '0843/1054',
    '도보',
    '토 증편',
    '1일, 8일, 15일, 20일, 22일 29일',
    '▶ 세계 3대 코스 중 하나인 차마고도 미니 트레킹',
    '▶ 파인이스트 괌 골프장 18홀 + 서비스 9홀',
    '① ETA https://g-cnmi-eta.cbp.dhs.gov',
    '야채절임, 디저트',
    '카오소이',
    '+맥주1병',
    '피로를 덜어주는 대만식 발맛사지 30분',
    '※ 사진은 연출된 이미지이며, 실제 음식은 조리 과정에 따라 플레이팅이 달라질 수 있습니다.',
  ])('ignores operational, entry, golf, and meal text instead of queueing an attraction: %s', rawText => {
    const result = applyProductRegistrationV3Matching(
      attractionLedger(rawText),
      [],
      '테스트',
    );

    expect(result.matchSummary.attraction_matched_count).toBe(0);
    expect(result.matchSummary.attraction_unmatched_count).toBe(0);
  });

  it('keeps a plausible unverified landmark in the review queue', () => {
    const result = applyProductRegistrationV3Matching(
      attractionLedger('층층이 연결된 자연의 신비 악화쌍폭포'),
      [],
      '백두산',
    );

    expect(result.matchSummary.attraction_matched_count).toBe(0);
    expect(result.matchSummary.attraction_unmatched_count).toBe(1);
  });

  it('treats deliberately spaced Korean city cells as destination scope, not attractions', () => {
    const result = applyProductRegistrationV3Matching(
      attractionLedger('여 강'),
      [{
        id: 'lijiang-old-town',
        name: '여강고성',
        region: '여강',
        is_active: true,
        customer_publishable: true,
      }],
      '곤명/여강/대리/샹그릴라',
    );

    expect(result.matchSummary.attraction_matched_count).toBe(0);
    expect(result.matchSummary.attraction_unmatched_count).toBe(0);
    expect(result.ledger.variants[0].days[0].events[0].type).toBe('notice');
  });

  it('does not queue an altitude and cable-car continuation after a matched attraction', () => {
    const ledger = attractionLedger('옥룡설산');
    ledger.variants[0].days[0].events.push({
      ...ledger.variants[0].days[0].events[0],
      raw_text: '(5,596m, 차마고도의 성산, 빙천 (케이블카)',
      evidence: {
        ...ledger.variants[0].days[0].events[0].evidence,
        line_start: 2,
        line_end: 2,
      },
    });
    const result = applyProductRegistrationV3Matching(
      ledger,
      [{
        id: 'jade-dragon-snow-mountain',
        name: '옥룡설산',
        region: '여강',
        is_active: true,
        customer_publishable: true,
      }],
      '여강',
    );

    expect(result.matchSummary.attraction_matched_count).toBe(1);
    expect(result.matchSummary.attraction_unmatched_count).toBe(0);
    expect(result.ledger.variants[0].days[0].events[1].type).toBe('notice');
  });
});
