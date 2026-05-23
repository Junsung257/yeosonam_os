/**
 * 블로그 카테고리 상수 — SSOT
 *
 * BlogDataFetcher(admin UI), blog-publisher(cron), blog-quality-gate 등에서
 * 동일한 유효 카테고리 목록을 공유하기 위한 단일 파일.
 * 새 카테고리 추가 시 이 파일만 수정하면 모든 곳에 반영된다.
 */

export const VALID_CATEGORIES = [
  'product_intro', 'travel_tips', 'visa_info',
  'itinerary', 'preparation', 'local_info',
] as const;

export type BlogCategory = (typeof VALID_CATEGORIES)[number];

export const CAT_LABELS: Record<string, string> = {
  product_intro: '상품 소개',
  travel_tips: '여행팁',
  visa_info: '비자·입국',
  itinerary: '추천일정',
  preparation: '여행준비',
  local_info: '현지정보',
};
