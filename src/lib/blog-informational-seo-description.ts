import type { BlogInformationIntent } from './blog-information-contract';

const INTENT_DESCRIPTION: Record<BlogInformationIntent, string> = {
  monthly_weather: '1~12월 평균 기온과 강수 자료, 관측 기간, 월별 옷차림, 출발 직전 공식 예보 확인 순서를 한 번에 정리했습니다.',
  food_budget: '검증된 현지 가격을 기준으로 1인 하루 식비 범위, 끼니별 예산, 대표 메뉴 가격과 추가 비용 확인 항목을 정리했습니다.',
  airport_transport: '공항에서 숙소까지 이동 수단별 소요 시간과 비용, 이용 조건, 심야 도착 시 확인할 공식 정보를 비교했습니다.',
  hotel_areas: '여행 동선과 교통, 숙박 지역별 장단점, 일정 유형에 맞는 선택 기준과 예약 전 확인 항목을 정리했습니다.',
  family_budget: '가족 인원과 일정에 따른 항공·숙박·식비·교통 예산 범위, 추가 비용과 출발 전 확인 항목을 정리했습니다.',
  itinerary: '일자별 이동 동선과 체류 시간, 예약이 필요한 구간, 교통 연결과 일정 변경 시 확인할 기준을 정리했습니다.',
  shopping_souvenirs: '선물 품목별 가격 기준과 구매 장소, 면세·반입 조건, 정품 여부와 영업 정보를 확인하는 순서를 정리했습니다.',
  currency_payment: '공식 통화와 환율 확인 기준, 현금·카드 사용 조건, 수수료와 결제 전 주의사항을 여행자 관점에서 정리했습니다.',
  entry_requirements: '대한민국 여행자의 입국·비자 요건, 필요 서류, 체류 조건과 출발 직전 공식 기관 확인 순서를 정리했습니다.',
  travel_insurance: '보장 항목과 제외 조건, 의료비·휴대품·취소 보장 비교 기준, 가입 전 약관 확인 순서를 여행자 관점에서 정리했습니다.',
  general: '여행자가 먼저 확인할 핵심 기준과 공식 출처, 준비 순서, 현지에서 달라질 수 있는 조건을 목적지별로 정리했습니다.',
};

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/[.!?。]+$/u, '').trim();
}

export function buildBlogInformationalSeoDescription(input: {
  title: string;
  intent: BlogInformationIntent;
}): string {
  const title = clean(input.title);
  const detail = INTENT_DESCRIPTION[input.intent] ?? INTENT_DESCRIPTION.general;
  return `${title}. ${detail}`.slice(0, 160).trim();
}
