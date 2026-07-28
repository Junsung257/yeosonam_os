import { describe, expect, it } from 'vitest';
import {
  BLOG_INFORMATION_INTENTS,
  buildBlogInformationContract,
  inferBlogInformationIntent,
  inspectBlogInformationMarkdown,
  type BlogInformationPublishableIntent,
} from './blog-information-contract';
import { validateBlogInformationStructure } from './blog-information-structure';

const BASE: Record<BlogInformationPublishableIntent, string> = {
  food_budget: `
조사 기준일 2026-07-15, 통화 USD. 근거: https://tourism.example.org/food
| 유형 | 1인 하루 총액 |
| --- | --- |
| 절약 | USD 30 |
| 일반 | USD 50 |
| 여유 | USD 80 |
| 끼니 | 대표 메뉴 | 가격 |
| --- | --- | --- |
| 아침 | 쌀국수 | USD 5 |
| 점심 | 반미 | USD 7 |
| 저녁 | 해산물 전골 | USD 18 |
| 간식 | 연유 커피 | USD 3 |
3박 4일 여행 총액은 일반형 기준 USD 150입니다.`,
  monthly_weather: `
관측 기간 1991-2020 평년값. 출처 https://weather.example.gov/climate
| 월 | 최고 | 최저 | 강수량 | 옷차림 |
| --- | --- | --- | --- | --- |
${Array.from({ length: 12 }, (_, index) => `| ${index + 1}월 | ${index + 10}℃ | ${index + 1}℃ | ${index * 8 + 20}mm | ${index < 3 ? '코트' : index < 8 ? '반팔과 우산' : '재킷'} |`).join('\n')}`,
  airport_transport: `
확인일 2026-07-15. 공식 운영사 https://airport.example.gov/transport
| 교통수단 | 가격 | 소요시간 | 첫차·막차 |
| --- | --- | --- | --- |
| 공항철도 | JPY 1,200 | 35분 | 06:00~23:00 |
| 리무진버스 | JPY 1,800 | 55분 | 05:30~22:30 |
| 택시 | JPY 8,000 | 40분 | 24시간 운영 |
수하물이 크면 버스나 택시를, 심야 도착이면 24시간 택시 승강장을 확인합니다.`,
  local_transport: `
확인일 2026-07-15. 공식 운영사 https://transit.example.gov/routes
| 노선·수단 | 요금 | 소요시간·배차 | 운행시간 |
| --- | --- | --- | --- |
| 밴프-레이크 루이스 버스 | CAD 12.50 | 57분 · 30분 간격 | 07:00~22:00 |
| 레이크 루이스 셔틀 | CAD 8 | 45분 · 60분 간격 | 08:00~19:00 |
승차권과 패스는 공식 운영사에서 구매·예약합니다. 성수기와 계절별 운행 변경 및 운휴 제한을 확인합니다.`,
  hotel_areas: `
| 실제 숙소 지역 | 1박 가격 | 장점과 단점 | 접근성 | 추천 대상 |
| --- | --- | --- | --- | --- |
| 난바 | JPY 12,000~20,000 | 식당이 가깝지만 혼잡 | 역 도보 5분 | 친구 여행자 추천 |
| 우메다 | JPY 15,000~25,000 | 교통이 편리하지만 비쌈 | 공항철도역 도보 8분 | 가족 추천 |
| 덴노지 | JPY 9,000~16,000 | 조용하지만 중심지에서 멀음 | 지하철역 도보 6분 | 혼자 여행자 추천 |`,
  family_budget: `
성인 2명, 아동 1명, 3박 4일 가족 기준입니다. 통화 SGD, 기준일 2026-07-15.
| 예산 항목 | 금액 |
| --- | --- |
| 항공 | SGD 1,200 |
| 숙소 | SGD 900 |
| 식비 | SGD 420 |
| 교통 | SGD 160 |
| 관광 | SGD 240 |
| 총액 | SGD 2,920 |`,
  itinerary: `
| 일차 | 장소 | 이동 관계 | 현실적인 시간 | 휴무·예약 조건 |
| --- | --- | --- | --- | --- |
| 1일 차 | 아사쿠사 센소지 | 지하철 이동 | 09:00~12:00 | 연중 운영, 예약 불필요 |
| 2일 차 | 우에노 미술관 | 도보와 지하철 이동 | 10:00~15:30 | 월요일 휴무, 사전 예약 확인 |
| 3일 차 | 오다이바 해변공원 | 버스 이동 | 11:00~17:00 | 운영시간과 입장 마감 확인 |`,
  shopping_souvenirs: `
가격 확인일 2026-07-15. 세관 공식 근거 https://customs.example.gov/import
| 실제 기념품 품목 | 가격 | 구매 지역과 매장 |
| --- | --- | --- |
| 건망고 | PHP 180 | 세부 시티 아얄라몰 매장 |
| 드라이 코코넛 | PHP 120 | 카본 시장 식품점 |
| 기타 키링 | PHP 250 | 막탄 공항 기념품 매장 |
식품 반입과 면세 한도는 관세청 공식 안내를 출국 전 다시 확인합니다.`,
  currency_payment: `
통화 CNY, 환율 기준일 2026-07-15. 근거 https://bank.example.gov/rates
| 결제수단 | 수수료 | 현금 사용 조건 |
| --- | --- | --- |
| 국제 신용카드 | 1.5% | 대형 매장 사용 가능 |
| 모바일 QR 결제 | CNY 3 | 본인 인증과 통신 필요 |
| 현금 | CNY 0 | 시장과 소형 매장에서 필요 |
ATM 인출 수수료와 카드 결제 거절에 대비해 현금을 나눠 준비합니다.`,
  entry_requirements: `
목적 국가 일본. 여행자 국적 대한민국, 관광 목적 15일 체류 기준입니다.
여권 유효기간과 비자·전자 허가 ETA, 입국 신고 조건을 확인합니다.
확인일 2026-07-15. 공식 1차 출처 https://www.immigration.go.jp/entry`,
  travel_insurance: `
확인일 2026-07-15. 보험사 공식 약관 https://policy.example.com/travel
| 보장 항목 | 한도 | 자기부담금 | 면책·청구 조건 |
| --- | --- | --- | --- |
| 해외 의료비 | 한도 KRW 50,000,000 | KRW 100,000 | 기존 질환 면책, 진단서 청구 |
| 상해·질병 | 한도 KRW 30,000,000 | KRW 50,000 | 음주 사고 제외, 영수증 청구 |
| 수하물 분실 | 한도 KRW 1,000,000 | KRW 30,000 | 경찰 확인서와 항공사 서류 청구 |`,
};

function completeFixture(intent: BlogInformationPublishableIntent): string {
  const contract = buildBlogInformationContract({
    intentType: intent,
    destination: intent === 'travel_insurance' ? null : '테스트 목적지',
  });
  const labels = contract.requiredSlots.map((slot) => `## ${slot.label}\n\n위 구조화 표와 확인값을 적용합니다.`).join('\n\n');
  return `${labels}\n\n${BASE[intent]}`;
}

describe('blog information structured intent contracts', () => {
  it.each(BLOG_INFORMATION_INTENTS)('rejects a label-only %s sample', (intent) => {
    const contract = buildBlogInformationContract({
      intentType: intent,
      destination: intent === 'travel_insurance' ? null : '테스트 목적지',
    });
    const markdown = contract.requiredSlots.map((slot) => `## ${slot.label}\n\n안내입니다.`).join('\n\n');
    const report = inspectBlogInformationMarkdown({ markdown, contract });
    expect(report.passed).toBe(false);
    expect(report.structuredIssues.length).toBeGreaterThan(0);
  });

  it.each(BLOG_INFORMATION_INTENTS)('accepts a complete structured %s fixture', (intent) => {
    const report = validateBlogInformationStructure({ intent, markdown: completeFixture(intent) });
    expect(report, report.issues.join(',')).toMatchObject({ passed: true });
  });

  it('classifies shopping and souvenirs explicitly instead of general', () => {
    expect(inferBlogInformationIntent({ destination: '세부', topic: '세부 쇼핑 기념품 가격과 구매 지역' }))
      .toBe('shopping_souvenirs');
  });

  it('rejects tables whose cells are empty placeholders', () => {
    const markdown = `
| 품목 | 가격 | 구매 지역 |
| --- | --- | --- |
| 기념품 A | - | - |
| 기념품 B | 미정 | 미정 |
| 기념품 C | 확인 필요 | 확인 필요 |`;
    const report = validateBlogInformationStructure({ intent: 'shopping_souvenirs', markdown });
    expect(report.passed).toBe(false);
    expect(report.issues).toContain('shopping_souvenirs:item_rows_required');
  });

  it('accepts food-budget rows when the local currency is declared once in the total header', () => {
    const markdown = BASE.food_budget.replace(
      `| 유형 | 1인 하루 총액 |\n| --- | --- |\n| 절약 | USD 30 |\n| 일반 | USD 50 |\n| 여유 | USD 80 |`,
      `| 예산 유형 | 1인 1일 총액 (USD) | 산정 근거 |\n| --- | --- | --- |\n| 절약형 | 30~40 | 공식 메뉴 가격 |\n| 일반형 | 50~60 | 공식 메뉴 가격 |\n| 여유형 | 80~100 | 공식 메뉴 가격 |`,
    );
    const report = validateBlogInformationStructure({ intent: 'food_budget', markdown });
    expect(report, report.issues.join(',')).toMatchObject({ passed: true });
  });

  it('rejects low-quality tables that repeat one numeric value in every row', () => {
    const markdown = BASE.hotel_areas.replace(/12,000~20,000|15,000~25,000|9,000~16,000|5분|8분|6분/g, '100');
    const report = validateBlogInformationStructure({ intent: 'hotel_areas', markdown });
    expect(report.passed).toBe(false);
    expect(report.issues).toContain('hotel_areas:insufficient_unique_values');
  });

  it('preserves mandatory human review for both high-risk intents', () => {
    for (const intent of ['entry_requirements', 'travel_insurance'] as const) {
      const contract = buildBlogInformationContract({
        intentType: intent,
        destination: intent === 'entry_requirements' ? '일본' : null,
      });
      expect(contract.humanReview.required).toBe(true);
    }
  });
});
