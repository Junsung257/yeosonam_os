import type { BlogInformationPlannerInput } from './blog-information-planner';
import type { BlogInformationIntent } from './blog-information-contract';

export type BlogInformationEvalDuplicateMode = 'new' | 'existing_active';
export type BlogInformationEvalCtaMode = 'unset' | 'configured';
export type BlogInformationEvalExpectedState = 'published' | 'pending_review' | 'blocked_plan' | 'update_existing';

export interface BlogInformationEngineV2EvalFixture {
  id: string;
  label: string;
  slug: string;
  plannerInput: BlogInformationPlannerInput;
  expectedIntent: BlogInformationIntent;
  claimText?: string;
  duplicateMode: BlogInformationEvalDuplicateMode;
  ctaMode: BlogInformationEvalCtaMode;
  expectedCtaKeys: string[];
  expectedPublishState: BlogInformationEvalExpectedState;
}

const STANDARD_CTA_KEYS = ['DEAL_ROOM', 'RELATED_ARTICLES'];

export const BLOG_INFORMATION_ENGINE_V2_EVAL_FIXTURES: BlogInformationEngineV2EvalFixture[] = [
  {
    id: 'sapporo_food_budget',
    label: '삿포로 식비',
    slug: 'sapporo-food-budget-eval',
    plannerInput: { topic: '삿포로 식비', destination: '삿포로', primaryKeyword: '삿포로 식비' },
    expectedIntent: 'food_budget',
    claimText: '점심 메뉴 가격은 1,200엔입니다.',
    duplicateMode: 'new',
    ctaMode: 'configured',
    expectedCtaKeys: STANDARD_CTA_KEYS,
    expectedPublishState: 'published',
  },
  {
    id: 'guangzhou_monthly_weather',
    label: '광저우 월별 날씨',
    slug: 'guangzhou-monthly-weather-eval',
    plannerInput: { topic: '광저우 월별 날씨', destination: '광저우', primaryKeyword: '광저우 월별 날씨' },
    expectedIntent: 'monthly_weather',
    claimText: '7월 평균 기온은 28℃입니다.',
    duplicateMode: 'new',
    ctaMode: 'configured',
    expectedCtaKeys: ['NAVER_CAFE', 'RELATED_ARTICLES'],
    expectedPublishState: 'published',
  },
  {
    id: 'osaka_airport_transport',
    label: '오사카 공항 이동',
    slug: 'osaka-airport-transport-eval',
    plannerInput: { topic: '오사카 공항 이동', destination: '오사카', primaryKeyword: '오사카 공항 이동' },
    expectedIntent: 'airport_transport',
    claimText: '공항에서 시내까지 약 50분이 걸립니다.',
    duplicateMode: 'new',
    ctaMode: 'configured',
    expectedCtaKeys: ['CONSULTATION', 'RELATED_ARTICLES'],
    expectedPublishState: 'published',
  },
  {
    id: 'taiwan_hotel_areas',
    label: '대만 숙소 지역',
    slug: 'taiwan-hotel-areas-eval',
    plannerInput: { topic: '대만 숙소 지역', destination: '대만', primaryKeyword: '대만 숙소 지역' },
    expectedIntent: 'hotel_areas',
    claimText: '대표 지역의 1박 비용은 150,000원입니다.',
    duplicateMode: 'new',
    ctaMode: 'configured',
    expectedCtaKeys: ['CONSULTATION', 'RELATED_ARTICLES'],
    expectedPublishState: 'published',
  },
  {
    id: 'singapore_family_budget',
    label: '싱가포르 가족 예산',
    slug: 'singapore-family-budget-eval',
    plannerInput: { topic: '싱가포르 가족 예산', destination: '싱가포르', primaryKeyword: '싱가포르 가족 예산' },
    expectedIntent: 'family_budget',
    claimText: '가족 식비 예산은 하루 200달러입니다.',
    duplicateMode: 'new',
    ctaMode: 'configured',
    expectedCtaKeys: STANDARD_CTA_KEYS,
    expectedPublishState: 'published',
  },
  {
    id: 'entry_visa_high_risk',
    label: '입국·비자 고위험',
    slug: 'japan-entry-visa-high-risk-eval',
    plannerInput: { topic: '한국인 일본 입국 비자 조건', destination: '일본', travelerNationality: 'KR' },
    expectedIntent: 'entry_requirements',
    claimText: '한국인은 관광 비자가 필요하지 않습니다.',
    duplicateMode: 'new',
    ctaMode: 'configured',
    expectedCtaKeys: ['RELATED_ARTICLES'],
    expectedPublishState: 'pending_review',
  },
  {
    id: 'insurance_high_risk',
    label: '보험 고위험',
    slug: 'travel-insurance-high-risk-eval',
    plannerInput: { topic: '여행자 보험 보장과 면책 조건', destination: null },
    expectedIntent: 'travel_insurance',
    claimText: '여행자 보험은 해외 의료비를 보장합니다.',
    duplicateMode: 'new',
    ctaMode: 'configured',
    expectedCtaKeys: ['RELATED_ARTICLES'],
    expectedPublishState: 'pending_review',
  },
  {
    id: 'invalid_destination_slug',
    label: '잘못된 목적지 slug',
    slug: 'student-airport-transfer-eval',
    plannerInput: { topic: '대학생 공항 이동', destination: '대학생' },
    expectedIntent: 'airport_transport',
    duplicateMode: 'new',
    ctaMode: 'unset',
    expectedCtaKeys: [],
    expectedPublishState: 'blocked_plan',
  },
  {
    id: 'duplicate_destination_intent',
    label: '동일 destination+intent 중복 생성',
    slug: 'sapporo-food-budget-duplicate-eval',
    plannerInput: { topic: '2027 삿포로 식비', destination: '삿포로', primaryKeyword: '삿포로 식비' },
    expectedIntent: 'food_budget',
    claimText: '점심 메뉴 가격은 1,200엔입니다.',
    duplicateMode: 'existing_active',
    ctaMode: 'unset',
    expectedCtaKeys: ['RELATED_ARTICLES'],
    expectedPublishState: 'update_existing',
  },
  {
    id: 'cta_url_unset',
    label: 'URL 미설정 CTA',
    slug: 'sapporo-food-cta-unset-eval',
    plannerInput: { topic: '삿포로 식비와 메뉴 가격', destination: '삿포로' },
    expectedIntent: 'food_budget',
    claimText: '점심 메뉴 가격은 1,200엔입니다.',
    duplicateMode: 'new',
    ctaMode: 'unset',
    expectedCtaKeys: ['RELATED_ARTICLES'],
    expectedPublishState: 'published',
  },
  {
    id: 'cta_url_configured',
    label: 'URL 설정 CTA',
    slug: 'sapporo-food-cta-configured-eval',
    plannerInput: { topic: '삿포로 식비 예산과 가격', destination: '삿포로' },
    expectedIntent: 'food_budget',
    claimText: '점심 메뉴 가격은 1,200엔입니다.',
    duplicateMode: 'new',
    ctaMode: 'configured',
    expectedCtaKeys: STANDARD_CTA_KEYS,
    expectedPublishState: 'published',
  },
];
