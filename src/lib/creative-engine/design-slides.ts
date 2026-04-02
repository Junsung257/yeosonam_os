/**
 * ══════════════════════════════════════════════════════════
 * Slide Designer — 상품 데이터 → 슬라이드 장수·역할 자동 결정
 * ══════════════════════════════════════════════════════════
 */

import type { ParsedProductData, ParsedHighlight } from './parse-product';

// ── 슬라이드 역할 타입 ─────────────────────────────────────

export type SlideRoleType =
  | 'hook'
  | 'benefit'
  | 'highlight_scene'
  | 'highlights_combined'
  | 'itinerary'
  | 'meal'
  | 'cta';

export interface SlideRole {
  type: SlideRoleType;
  data?: ParsedProductData;
  highlight?: ParsedHighlight;
  highlights?: ParsedHighlight[];
  region?: string;
  key_points?: string[];
}

// ── 슬라이드 장수 결정 ─────────────────────────────────────

export function decideSlideCount(data: ParsedProductData): number {
  let count = 4;

  const activeDays = data.itinerary.filter(d => d.key_points.length > 0).length;
  if (activeDays >= 3) count = 5;
  if (activeDays >= 4) count = 6;
  if (data.nights >= 6) count = 7;
  if (data.meals.korean.length >= 3) count = Math.max(count, 5);
  if (data.highlights.length >= 5) count = Math.max(count, 6);

  return Math.min(count, 8);
}

// ── 슬라이드 역할 배정 ─────────────────────────────────────

export function assignSlideRoles(data: ParsedProductData, slideCount: number): SlideRole[] {
  const roles: SlideRole[] = [];

  // 1장: 후킹
  roles.push({ type: 'hook', data });

  // 2장: 혜택
  roles.push({ type: 'benefit', data });

  // 중간 장수
  const middleCount = slideCount - 3; // hook + benefit + cta 제외

  // 비주얼 스코어 상위 하이라이트
  const topHighlights = [...data.highlights]
    .sort((a, b) => b.visual_score - a.visual_score)
    .slice(0, 3);

  if (middleCount === 1) {
    // 중간 1장: 하이라이트 묶음
    roles.push({ type: 'highlights_combined', highlights: topHighlights, data });
  } else if (middleCount === 2) {
    // 중간 2장: 하이라이트 1 + 식사
    if (topHighlights.length > 0) {
      roles.push({ type: 'highlight_scene', highlight: topHighlights[0], data });
    } else {
      roles.push({ type: 'highlights_combined', highlights: topHighlights, data });
    }
    roles.push({ type: 'meal', data });
  } else {
    // 중간 3장 이상: 지역별 일정 + 식사
    const regions = [...new Set(
      data.itinerary
        .filter(d => d.key_points.length > 0)
        .map(d => d.regions[0])
        .filter(Boolean)
    )];

    if (regions.length > 0) {
      regions.slice(0, middleCount - 1).forEach(region => {
        const days = data.itinerary.filter(d => d.regions.includes(region));
        roles.push({
          type: 'itinerary',
          region,
          key_points: days.flatMap(d => d.key_points).slice(0, 4),
          highlights: data.highlights.filter(h =>
            days.map(d => d.day).includes(h.day)
          ),
          data,
        });
      });
    } else {
      // 일정 없으면 하이라이트로 채움
      topHighlights.slice(0, middleCount - 1).forEach(h => {
        roles.push({ type: 'highlight_scene', highlight: h, data });
      });
    }

    // 나머지 장수에 식사 추가
    if (data.meals.korean.length >= 2 && roles.length < slideCount - 1) {
      roles.push({ type: 'meal', data });
    }
  }

  // 부족한 중간 슬라이드 채우기
  while (roles.length < slideCount - 1) {
    if (topHighlights.length > 0) {
      const idx = (roles.length - 2) % topHighlights.length;
      roles.push({ type: 'highlight_scene', highlight: topHighlights[idx], data });
    } else {
      roles.push({ type: 'highlights_combined', highlights: [], data });
    }
  }

  // 마지막: CTA
  roles.push({ type: 'cta', data });

  return roles.slice(0, slideCount);
}
