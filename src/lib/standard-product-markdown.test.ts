import { describe, expect, it } from 'vitest';
import { isStandardProductMarkdown, parseStandardProductMarkdown } from './standard-product-markdown';
import { pkgToIntake } from './pkg-to-ir';
import { evaluateRenderClaimCoverage } from './render-claim-coverage';

const SAMPLE = `YSN-PRODUCT-MD v1

## 기본정보
- 상품명: [LJ 오후출발] 나트랑/달랏 5성 3박5일
- 목적지: 나트랑/달랏
- 국가: 베트남
- 상품타입: 패키지
- 여행스타일: 3박5일
- 출발공항: 부산
- 항공: LJ
- 출발편: LJ115 21:35 부산 -> 00:25 나트랑
- 귀국편: LJ116 01:00 나트랑 -> 06:40 부산
- 출발요일: 매주 목요일
- 최소출발: 6명
- 발권마감: 출발 7일 전
- 랜드사: 투어코코넛
- 커미션: 10%

## 가격
| 라벨 | 날짜 | 성인 | 아동 | 상태 | 비고 |
| --- | --- | --- | --- | --- | --- |
| 기본 | 전 출발일 | 619,000원 | 619,000원 | 가능 | |

## 포함
- 왕복항공권
- 전 일정 호텔

## 불포함
- 가이드/기사 경비

## 선택관광
- 달랏 야시장 | $30/인 | 현지결제

## 일정
### DAY 1 | 부산, 나트랑 | 나트랑 5성 호텔(5성) | 조:X / 중:X / 석:X
- 21:35 | LJ115 부산 출발 | flight
- 00:25 | 나트랑 도착 | flight

### DAY 2 | 나트랑, 달랏 | 달랏 5성 호텔(5성) | 조:호텔식 / 중:현지식 / 석:현지식
- 09:00 | 죽림선원 관광 | normal

## 공지
- CRITICAL | 여권/비자 | 여권 만료일은 출발일 기준 6개월 이상 남아 있어야 하며, 비자 필요 여부는 예약 전 확인해 주세요.
- PAYMENT | 발권/결제 | 발권마감 이후에는 항공 좌석과 요금이 변동될 수 있어 예약 확정 전 최종 안내가 필요합니다.
- POLICY | 취소/변경 | 취소료는 여행약관과 항공사 규정에 따라 적용되며, 특가 항공권은 별도 조건이 우선될 수 있습니다.
- INFO | 현지 안내 | 현지 사정과 항공 스케줄에 따라 일정 순서가 변경될 수 있으며 동급 호텔로 대체될 수 있습니다.

## 취소규정
- 표준 약관 적용`;

describe('standard product markdown', () => {
  it('detects the YSN structured markdown format', () => {
    expect(isStandardProductMarkdown(SAMPLE)).toBe(true);
    expect(isStandardProductMarkdown('plain raw travel text')).toBe(false);
  });

  it('converts markdown into parser output without LLM usage', () => {
    const parsed = parseStandardProductMarkdown(SAMPLE);

    expect(parsed.confidence).toBe(0.98);
    expect(parsed.extractedData.title).toContain('나트랑/달랏');
    expect(parsed.extractedData.price).toBe(619000);
    expect(parsed.extractedData.price_tiers?.[0].adult_price).toBe(619000);
    expect(parsed.extractedData.ticketing_deadline).toBeUndefined();
    expect(parsed.extractedData.notices_parsed?.map(n => typeof n === 'string' ? n : n.type)).toEqual([
      'CRITICAL',
      'PAYMENT',
      'POLICY',
      'INFO',
    ]);
    expect(parsed.extractedData._llm_meta?.provider).toBe('standard-markdown');
    expect(parsed.extractedData._llm_meta?.tokens_input).toBe(0);
    expect(parsed.itineraryData?.meta.flight_out).toBe('LJ115');
    expect(parsed.itineraryData?.meta.flight_in).toBe('LJ116');
    expect(parsed.itineraryData?.days[0].schedule[0].type).toBe('flight');
    expect(parsed.itineraryData?.days[1].schedule[0].activity).toBe('죽림선원 관광');
  });

  it('keeps manually supplied attraction ids as arrays and ignores cabin-night grade', () => {
    const parsed = parseStandardProductMarkdown(`YSN-PRODUCT-MD v1

## 기본정보
- 상품명: 테스트
- 목적지: 나트랑
- 여행스타일: 3박5일

## 일정
### DAY 5 | 나트랑, 부산 | 기내박(기내) | 조:X / 중:X / 석:X
- 10:00 | 죽림선원 관광 | normal | 관광지ID: 5728e681-636b-42fa-87b5-a2f0b7b0379c`);
    const days = parsed.itineraryData?.days || [];
    const last = days[days.length - 1];

    expect(last?.hotel?.grade).toBeNull();
    expect(last?.schedule[0].attraction_ids).toEqual(['5728e681-636b-42fa-87b5-a2f0b7b0379c']);
  });

  it('keeps customer render claims backed by the markdown source', () => {
    const parsed = parseStandardProductMarkdown(SAMPLE);
    const pkg = {
      title: parsed.extractedData.title,
      destination: parsed.extractedData.destination,
      country: parsed.extractedData.destination,
      product_type: parsed.extractedData.product_type,
      trip_style: parsed.extractedData.trip_style,
      duration: parsed.extractedData.duration,
      nights: 3,
      departure_airport: parsed.extractedData.departure_airport,
      departure_days: parsed.extractedData.departure_days,
      airline: parsed.extractedData.airline,
      min_participants: parsed.extractedData.min_participants,
      ticketing_deadline: parsed.extractedData.ticketing_deadline,
      price: parsed.extractedData.price,
      price_tiers: parsed.extractedData.price_tiers,
      inclusions: parsed.extractedData.inclusions,
      excludes: parsed.extractedData.excludes,
      optional_tours: parsed.extractedData.optional_tours as unknown as Record<string, unknown>[],
      accommodations: parsed.extractedData.accommodations,
      itinerary_data: parsed.itineraryData,
      raw_text: parsed.rawText,
      commission_rate: 10,
    };
    const intake = pkgToIntake(pkg as Parameters<typeof pkgToIntake>[0], { landOperatorName: '투어코코넛' });
    const coverage = evaluateRenderClaimCoverage(
      pkg as unknown as Parameters<typeof evaluateRenderClaimCoverage>[0],
      intake.ir.sourceEvidence,
    );

    expect(coverage.unsupported.map(c => c.value)).not.toContain('LJ115');
    expect(coverage.unsupported.map(c => c.value)).not.toContain('죽림선원 관광');
    expect(coverage.ratio).toBeGreaterThanOrEqual(0.9);
  });
});
