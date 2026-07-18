import type { BlogInformationIntent } from './blog-information-contract';
import type { BlogInformationPlannerInput } from './blog-information-planner';

export type BlogInformationEvalExpectedState = 'published' | 'pending_review';

export interface BlogInformationEngineV2EvalFixture {
  id: string;
  label: string;
  slug: string;
  plannerInput: BlogInformationPlannerInput;
  expectedIntent: Exclude<BlogInformationIntent, 'general'>;
  expectedCtaKeys: string[];
  expectedPublishState: BlogInformationEvalExpectedState;
}

const RELATED = 'RELATED_ARTICLES';

export const BLOG_INFORMATION_ENGINE_V2_EVAL_FIXTURES: BlogInformationEngineV2EvalFixture[] = [
  {
    id: 'sapporo_food_budget',
    label: '삿포로 식비',
    slug: 'sapporo-food-budget-safety-eval',
    plannerInput: {
      intentType: 'food_budget',
      topic: '삿포로 식비와 메뉴 가격',
      destination: '삿포로',
      primaryKeyword: '삿포로 식비',
    },
    expectedIntent: 'food_budget',
    expectedCtaKeys: ['DEAL_ROOM', RELATED],
    expectedPublishState: 'published',
  },
  {
    id: 'guangzhou_monthly_weather',
    label: '광저우 월별 날씨',
    slug: 'guangzhou-monthly-weather-safety-eval',
    plannerInput: {
      intentType: 'monthly_weather',
      topic: '광저우 월별 날씨와 옷차림',
      destination: '광저우',
      primaryKeyword: '광저우 월별 날씨',
    },
    expectedIntent: 'monthly_weather',
    expectedCtaKeys: ['NAVER_CAFE', RELATED],
    expectedPublishState: 'published',
  },
  {
    id: 'osaka_airport_transport',
    label: '오사카 공항 이동',
    slug: 'osaka-airport-transport-safety-eval',
    plannerInput: {
      intentType: 'airport_transport',
      topic: '오사카 공항 이동 수단과 요금',
      destination: '오사카',
      primaryKeyword: '오사카 공항 이동',
    },
    expectedIntent: 'airport_transport',
    expectedCtaKeys: ['CONSULTATION', RELATED],
    expectedPublishState: 'published',
  },
  {
    id: 'taiwan_hotel_areas',
    label: '대만 숙소 지역',
    slug: 'taiwan-hotel-areas-safety-eval',
    plannerInput: {
      intentType: 'hotel_areas',
      topic: '대만 숙소 지역별 가격과 접근성',
      destination: '대만',
      primaryKeyword: '대만 숙소 지역',
    },
    expectedIntent: 'hotel_areas',
    expectedCtaKeys: ['CONSULTATION', RELATED],
    expectedPublishState: 'published',
  },
  {
    id: 'singapore_family_budget',
    label: '싱가포르 가족 예산',
    slug: 'singapore-family-budget-safety-eval',
    plannerInput: {
      intentType: 'family_budget',
      topic: '싱가포르 가족여행 예산',
      destination: '싱가포르',
      primaryKeyword: '싱가포르 가족 예산',
      audience: 'family',
    },
    expectedIntent: 'family_budget',
    expectedCtaKeys: ['DEAL_ROOM', RELATED],
    expectedPublishState: 'published',
  },
  {
    id: 'cebu_shopping_souvenirs',
    label: '세부 쇼핑·기념품',
    slug: 'cebu-shopping-souvenirs-safety-eval',
    plannerInput: {
      intentType: 'shopping_souvenirs',
      topic: '세부 쇼핑과 기념품 가격',
      destination: '세부',
      primaryKeyword: '세부 쇼핑 기념품',
    },
    expectedIntent: 'shopping_souvenirs',
    expectedCtaKeys: ['DEAL_ROOM', RELATED],
    expectedPublishState: 'published',
  },
  {
    id: 'shijiazhuang_currency_payment',
    label: '석가장 환전·결제',
    slug: 'shijiazhuang-currency-payment-safety-eval',
    plannerInput: {
      intentType: 'currency_payment',
      topic: '석가장 환전과 결제 수단',
      destination: '석가장',
      primaryKeyword: '석가장 환전 결제',
    },
    expectedIntent: 'currency_payment',
    expectedCtaKeys: ['DEAL_ROOM', RELATED],
    expectedPublishState: 'published',
  },
  {
    id: 'mongolia_weather_clothing',
    label: '몽골 날씨·옷차림',
    slug: 'mongolia-weather-clothing-safety-eval',
    plannerInput: {
      intentType: 'monthly_weather',
      topic: '몽골 월별 날씨와 옷차림',
      destination: '몽골',
      primaryKeyword: '몽골 날씨 옷차림',
    },
    expectedIntent: 'monthly_weather',
    expectedCtaKeys: ['NAVER_CAFE', RELATED],
    expectedPublishState: 'published',
  },
  {
    id: 'japan_entry_requirements',
    label: '일본 입국·비자',
    slug: 'japan-entry-visa-safety-eval',
    plannerInput: {
      intentType: 'entry_requirements',
      topic: '한국인 일본 입국과 비자 조건',
      destination: '일본',
      primaryKeyword: '일본 입국 비자',
      travelerNationality: 'KR',
    },
    expectedIntent: 'entry_requirements',
    expectedCtaKeys: ['OFFICIAL_SOURCE', RELATED],
    expectedPublishState: 'pending_review',
  },
  {
    id: 'overseas_travel_insurance',
    label: '해외여행 보험',
    slug: 'overseas-travel-insurance-safety-eval',
    plannerInput: {
      intentType: 'travel_insurance',
      topic: '해외여행 보험 보장과 면책 조건',
      primaryKeyword: '해외여행 보험',
    },
    expectedIntent: 'travel_insurance',
    expectedCtaKeys: ['OFFICIAL_SOURCE', RELATED],
    expectedPublishState: 'pending_review',
  },
];
