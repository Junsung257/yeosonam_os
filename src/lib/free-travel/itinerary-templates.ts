/**
 * 목적지별 “코스” 템플릿 — 일정표 생성이 1순위, MRT 예약 가능 상품은 키워드로 자연스럽게 매칭.
 *
 * 기본 시드: 오전·오후·저녁 슬롯(OTA/일정표 UX 관행). 레퍼런스 가산은 승인 패키지 itinerary_data.
 * 시중 일정 생성 AI·외부 일정 JSON을 붙일 때는 이 스톱 리스트를 대체/병합하는 어댑터를 두는 것이 맞음.
 */

import type { ActivityResult } from '@/lib/travel-providers/types';

export interface StopTemplate {
  label: string;
  timeHint: string;
  /** MRT 상품명에 포함되면 이 슬롯을 예약형(bookable)으로 연결 */
  match?: string[];
}

/** 풀데이(관광일)마다 로테이션할 코스 블록 */
export const ITINERARY_TEMPLATE_BLOCKS: Record<string, StopTemplate[][]> = {
  다낭: [
    [
      { label: '미케비치 해변 산책 · 현지 브런치', timeHint: '오전' },
      { label: '한 시장·항거리 (간식·기념품)', timeHint: '오후', match: ['한시장', '한 시장', 'hang'] },
      { label: '용다대교·한강 야경 산책', timeHint: '저녁' },
    ],
    [
      { label: '다낭 대성당·프랑스 거리', timeHint: '오전' },
      { label: '롱산사(손짜반도) 전망·드라이브', timeHint: '오후', match: ['롱산', 'son tra', 'linh ung'] },
      { label: '쏘낫데·나이트 마켓', timeHint: '저녁', match: ['시장', '야시장', 'sn'] },
    ],
    [
      { label: '바나힐·골든브릿지·케이블카(일정 핵심)', timeHint: '종일', match: ['바나', '바나힐', 'bana', '테마파크', 'sun world'] },
      { label: '린응웅 거리 카페·디저트', timeHint: '저녁' },
    ],
  ],
  도야마: [
    [
      { label: '도야마성 공원·구시가지 산책', timeHint: '오전' },
      { label: '스즈카가와 수로·카이오카 야채 시장', timeHint: '오후' },
      { label: '현지 해산물·스시 저녁', timeHint: '저녁' },
    ],
    [
      { label: '다카야마 당일(백로·산마치)', timeHint: '종일', match: ['다카야마', 'takayama', '시라카와'] },
      { label: '숙소 귀환·온천', timeHint: '저녁' },
    ],
  ],
  오사카: [
    [
      { label: '오사카성·공원', timeHint: '오전' },
      { label: '도톤보리·난바 쇼핑', timeHint: '오후', match: ['도톤', '난바'] },
      { label: '야경·쿠시카츠 골목', timeHint: '저녁' },
    ],
  ],
  도쿄: [
    [
      { label: '아사쿠사·스카이트리', timeHint: '오전' },
      { label: '긴자·츠키지 주변', timeHint: '오후' },
      { label: '시부야·야경', timeHint: '저녁' },
    ],
  ],
  후쿠오카: [
    [
      { label: '텐진·오호리 공원', timeHint: '오전' },
      { label: '야타이·하카타 라멘', timeHint: '오후', match: ['야타이', '하카타'] },
      { label: '캐널시티·쇼핑', timeHint: '저녁' },
    ],
  ],
};

function normalizeDest(destination: string): string {
  return destination.replace(/\s+/g, '').trim();
}

export function getTemplateBlocksForDestination(destination: string): StopTemplate[][] {
  const n = normalizeDest(destination);
  const key = Object.keys(ITINERARY_TEMPLATE_BLOCKS).find(
    k => n.includes(k) || destination.includes(k),
  );
  return key ? ITINERARY_TEMPLATE_BLOCKS[key]! : [];
}

function defaultBlock(middleDayIndex: number): StopTemplate[] {
  const seed = middleDayIndex % 3;
  const presets: StopTemplate[][] = [
    [
      { label: '시내 랜드마크·카페', timeHint: '오전' },
      { label: '현지 시장·쇼핑', timeHint: '오후' },
      { label: '야경·디저트', timeHint: '저녁' },
    ],
    [
      { label: '박물관·미술관(선택)', timeHint: '오전' },
      { label: '근교 해변·공원', timeHint: '오후' },
      { label: '현지 맛집', timeHint: '저녁' },
    ],
    [
      { label: '자유 산책·사진 스팟', timeHint: '오전' },
      { label: '테마 체험·투어(선택)', timeHint: '오후' },
      { label: '휴식·스파', timeHint: '저녁' },
    ],
  ];
  return presets[seed]!;
}

function matchActivity(template: StopTemplate, activities: ActivityResult[]): ActivityResult | null {
  if (!template.match?.length) {
    const parts = template.label.split(/[·,\s]+/).map(p => p.trim()).filter(p => p.length >= 2);
    for (const a of activities) {
      const low = a.name.toLowerCase();
      if (parts.some(p => low.includes(p.toLowerCase()))) return a;
    }
    return null;
  }
  for (const a of activities) {
    const low = a.name.toLowerCase();
    if (template.match.some(m => low.includes(m.toLowerCase()))) return a;
  }
  return null;
}

export interface BuiltStop {
  id: string;
  timeHint: string;
  label: string;
  kind: 'free' | 'bookable';
  activityProviderId?: string;
  priceHint?: number;
}

export function buildStopsForDay(params: {
  destination: string;
  calendarDay: number;
  middleDayIndex: number;
  isArrival: boolean;
  isDeparture: boolean;
  activities: ActivityResult[];
}): BuiltStop[] {
  const { destination, calendarDay, middleDayIndex, isArrival, isDeparture, activities } = params;

  if (isDeparture) {
    return [
      { id: `${calendarDay}-0`, timeHint: '오전', label: '체크아웃 · 짐 정리', kind: 'free' },
      { id: `${calendarDay}-1`, timeHint: '오전~오후', label: '공항(또는 역) 출발 · 귀국', kind: 'free' },
    ];
  }

  if (isArrival) {
    return [
      { id: `${calendarDay}-0`, timeHint: '오전~오후', label: '항공편 도착 · 입국', kind: 'free' },
      { id: `${calendarDay}-1`, timeHint: '오후', label: '숙소 체크인 · 시차·이동 피로 회복', kind: 'free' },
      { id: `${calendarDay}-2`, timeHint: '저녁', label: '숙소 주변 가벼운 산책·간단 식사', kind: 'free' },
    ];
  }

  const blocks = getTemplateBlocksForDestination(destination);
  const block =
    blocks.length > 0 ? blocks[middleDayIndex % blocks.length]! : defaultBlock(middleDayIndex);

  return block.map((t, idx) => {
    const act = activities.length > 0 ? matchActivity(t, activities) : null;
    const bookable = Boolean(act && act.price > 0);
    return {
      id: `${calendarDay}-${idx}`,
      timeHint: t.timeHint,
      label: t.label,
      kind: bookable ? 'bookable' : 'free',
      activityProviderId: bookable ? act!.providerId : undefined,
      priceHint: bookable ? act!.price : undefined,
    };
  });
}
