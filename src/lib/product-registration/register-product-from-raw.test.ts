import { describe, expect, it } from 'vitest';
import { registerProductFromRaw } from './register-product-from-raw';

function cebuRawText(): string {
  return `
부산出 세부 세미 PKG 3박 5일 진에어(LJ)
출발일
요일
솔레아[준특급]
두짓타니[특급]
제이파크[특급]
7/24~8/7
토일월화
859,000
1,029,000
1,079,000
수목금
889,000
1,079,000
1,119,000
포 함 사 항
항공요금+유류/텍스, 여행자보험, 전 일정 호텔(2인1실), 조식 및 일정상 식사, 스쿠버다이빙 강습, 특식2회
불포함 사항
가이드 & 기사팁 별도(성인&아동 동일) : 3박 $50 P/P, 써차지 및 의무디너, 싱글차지
선 택 관 광
체험다이빙&씨워크($120), 파라세일링($80), 럭셔리스톤&스파2시간30분($160), 스톤마사지2시간($100),
어메이징쇼($65)
쇼 핑 센 터
진주, 토산품, 건강보조식품, 잡화 중 3회 방문예정
비     고
성인 2명이상 출발 확정 (2인1실기준)
일 자
지 역
교 통
시 간
주 요 행사 일정
제1일
부 산
세 부
LJ 061
22:00
01:15
(+1)
부산 출발 / 세부 향발
세부 국제 공항 도착 후 가이드 미팅
리조트 이동 투숙 및 휴식
HOTEL : 상기 호텔 또는 동급
제2일
세 부
전용차량
전 일
호텔 조식 후
▶해양 스포츠 체험 스쿠버다이빙 무료강습(※체험 다이빙 별도)
▶세부 디스커버리 투어(재래시장, 열대과일 상점 방문)
▶필리핀 전통 오일마사지 60분 1회 (성인만/팁별도/아동불포함)
조: 리조트식
중: 한식
석: 특석식
HOTEL : 상기 호텔 또는 동급
제3일
세 부
전용차량
전 일
리조트 조식 후
리조트 내 자유시간 또는 선택관광 즐기기
♣ 추천 선택관광
세부 아일랜드 호핑투어 (스노쿨링+중식BBQ) / 현지 옵션가 $80/인
조: 리조트식
중: 불포함
석: 특석식
HOTEL : 상기 호텔 또는 동급
제4일
세 부
전용차량
전 일
리조트 조식 후 체크아웃
▶세부 막탄 시내관광 (막탄슈라인, 막탄 산토니뇨 성당)
▶여행의 또 다른 재미 필리핀 기념품 및 토산품관광
석식 후 공항으로 이동
기 내 박
제5일
세 부
부 산
LJ 062
02:15
07:25
세부 출발 / 부산 향발
부산 국제 공항 도착 후 해산
살펴보기
♣ 여권 유효기간은 6개월 이상 남아 있어야 합니다.
♣ 필리핀 입국시 이트래블 QR코드 필수입니다.
♣ 만 15세미만 승객 입국시, 반드시 부모 혹은 보호자 동반 해야합니다.
`.trim();
}

describe('registerProductFromRaw', () => {
  it('returns one standard registration result for the Cebu hotel-column matrix upload', async () => {
    const rawText = cebuRawText();

    const result = await registerProductFromRaw({
      rawText,
      documentRawText: rawText,
      extractedData: {
        title: '부산出 세부 세미 PKG 3박 5일 진에어(LJ)',
        destination: '세부',
        duration: 5,
        rawText,
      },
      title: '부산出 세부 세미 PKG 3박 5일 진에어(LJ)',
      activeAttractions: [],
      supplierCode: 'ETC',
      enableGeminiFallback: false,
    });

    expect(result.publishable).toBe(true);
    expect(result.identity.destination).toBe('세부');
    expect(result.identity.destinationCode).toBe('CEB');
    expect(result.pricing.minPrice).toBe(859000);
    expect(result.pricing.priceDates).toHaveLength(15);
    expect(result.pricing.productPrices).toHaveLength(45);
    expect(result.pricing.priceDates.every((row) => row.price === 859000 || row.price === 889000)).toBe(true);
    expect(result.pricing.productPrices.filter((row) => row.net_price === 1029000)).toHaveLength(8);
    expect(result.pricing.productPrices.filter((row) => row.net_price === 1119000)).toHaveLength(7);
    expect(new Set(result.pricing.productPrices.map((row) => row.note).filter(Boolean)).size).toBeGreaterThanOrEqual(6);
    expect(result.itinerary.itineraryInput?.days).toHaveLength(5);
    expect(result.extractedData.optional_tours?.map(tour => tour.name)).toEqual(expect.arrayContaining([
      '체험다이빙&씨워크',
      '파라세일링',
      '어메이징쇼',
      '세부 아일랜드 호핑투어 (스노쿨링+중식BBQ)',
    ]));
    expect(result.deliverability.ok).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('keeps external gate failures inside the same standard deliverability decision', async () => {
    const rawText = cebuRawText();

    const result = await registerProductFromRaw({
      rawText,
      documentRawText: rawText,
      extractedData: {
        title: '부산出 세부 세미 PKG 3박 5일 진에어(LJ)',
        destination: '세부',
        duration: 5,
        rawText,
      },
      title: '부산出 세부 세미 PKG 3박 5일 진에어(LJ)',
      activeAttractions: [],
      supplierCode: 'ETC',
      extraFailures: ['Product Registration V2 gate failed: fixture-block'],
      enableGeminiFallback: false,
    });

    expect(result.publishable).toBe(false);
    expect(result.deliverability.ok).toBe(false);
    expect(result.failures.join('\n')).toContain('fixture-block');
  });
});
