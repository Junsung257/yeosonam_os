/**
 * @file recommendation-copy.ts — "여소남의 추천 코멘트" 결정적 자동 생성 (2026-05-14 UX-5)
 *
 * 사장님 지적: "부관훼리를 이용한 초특가 가성비 무박3일 패키지 여행" 같은 무의미 카피.
 * 처방: 결정적 템플릿 + 진짜 특전/하이라이트 키워드 추출 → 셀링포인트 한 줄.
 */

import { isRealPerk } from '@/lib/render-contract';

interface CopyInput {
  title?: string | null;
  destination?: string | null;
  duration?: number | null;
  departure?: string | null;
  product_type?: string | null;
  inclusions?: string[] | null;
  product_highlights?: string[] | null;
  airline?: string | null;
}

/**
 * 입력에서 가장 강한 셀링포인트 1~2개 추출.
 * 우선순위: product_highlights > inclusions 중 진짜 특전 > 호텔/항공편 정보
 */
function pickHighlights(input: CopyInput): string[] {
  const out: string[] = [];
  if (input.product_highlights && input.product_highlights.length > 0) {
    out.push(...input.product_highlights.slice(0, 2));
  }
  if (out.length < 2 && input.inclusions) {
    const perks = input.inclusions.filter(s => isRealPerk(s)).slice(0, 2 - out.length);
    out.push(...perks);
  }
  return out;
}

/**
 * 결정적 카피 생성 — LLM 없이.
 * 양식:
 *   "<departure> 출발 <duration>일 <destination> 여행 — <selling_points>"
 */
export function generateRecommendationCopy(input: CopyInput): string {
  const parts: string[] = [];

  const dep = input.departure?.trim();
  const dur = input.duration && input.duration > 0 ? `${input.duration}일` : null;
  const dest = input.destination?.trim();

  if (dep && dur && dest) {
    parts.push(`${dep}에서 출발하는 ${dur} ${dest} 여행`);
  } else if (dur && dest) {
    parts.push(`${dur} ${dest} 여행`);
  } else if (dest) {
    parts.push(`${dest} 여행`);
  } else {
    parts.push('여행 패키지');
  }

  // ferry/cruise 면 특수 라벨
  if (input.product_type === 'cruise' || input.product_type === 'ferry') {
    const fname = input.airline?.trim();
    if (fname && !parts[0].includes(fname)) {
      parts[0] = `${fname} 이용 ${parts[0]}`;
    }
  } else if (input.airline) {
    const air = input.airline.trim();
    if (air && !parts[0].includes(air)) {
      parts[0] = `${air} ${parts[0]}`;
    }
  }

  const sellingPoints = pickHighlights(input);
  if (sellingPoints.length > 0) {
    parts.push(sellingPoints.join(' + '));
  }

  return parts.filter(Boolean).join(' — ');
}

/**
 * 너무 일반적이거나 짧은 카피 감지 — 사장님 사고 (부관훼리 케이스의 "X를 이용한 초특가 가성비")
 */
export function isWeakCopy(copy: string | null | undefined, title?: string | null): boolean {
  if (!copy || copy.length < 20) return true;
  if (title && copy.includes(title.replace(/\[.*?\]/g, '').trim())) {
    // title 을 그대로 재서술한 경우
    if (copy.length < title.length + 30) return true;
  }
  if (/^[가-힣\s]*패키지\s*여행$/.test(copy)) return true; // "...패키지 여행" 만 끝남
  return false;
}
