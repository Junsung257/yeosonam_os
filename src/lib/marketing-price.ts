/**
 * 마케팅 카피용 표시가 헬퍼 (v3.2, 2026-04-30).
 *
 * 문제: 패키지는 출발일별로 가격이 다른데 (price_dates),
 *      마케팅 자동화(card-news, blog 자동발행 등)가 단일 pkg.price를 쓰면
 *      "최저가 89만원" vs "실제 모든 출발일 평균 105만원" 같은 불일치 발생.
 *
 * 해결: price_dates의 최저가를 정직하게 사용. 없으면 pkg.price fallback.
 *
 * 사용처: card-news/route.ts, blog/from-card-news, blog/bulk-generate 등.
 */
import { getMinPriceFromDates } from './price-dates';

interface PriceablePkg {
  price?: number | null;
  price_dates?: Array<{ date?: string; price?: number; confirmed?: boolean }> | null;
}

/** 마케팅용 표시가 — price_dates 최저가 우선, 없으면 pkg.price */
export function pickMarketingPrice(pkg: PriceablePkg): number {
  if (Array.isArray(pkg.price_dates) && pkg.price_dates.length > 0) {
    const m = getMinPriceFromDates(pkg.price_dates as Parameters<typeof getMinPriceFromDates>[0]);
    if (m && m > 0) return m;
  }
  return pkg.price ?? 0;
}

/** "₩89만원~" 형식 (마케팅 카피 친화적, ~ 표시로 변동성 시사) */
export function formatMarketingPriceManwon(pkg: PriceablePkg): string {
  const v = pickMarketingPrice(pkg);
  if (v <= 0) return '';
  return `${Math.round(v / 10000)}만원~`;
}

/** "₩890,000~" 형식 (정확 금액 + 변동성 시사) */
export function formatMarketingPriceFull(pkg: PriceablePkg): string {
  const v = pickMarketingPrice(pkg);
  if (v <= 0) return '';
  return `${v.toLocaleString()}원~`;
}
