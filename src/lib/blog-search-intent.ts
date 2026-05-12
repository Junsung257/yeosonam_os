/**
 * 검색 의도 휴리스틱 분류 — LLM 없이 큐 메타·리포트용
 * (상업성: 패키지/특가/예약 / 정보성: 날씨·환율·비자 등)
 */

export type SearchIntent = 'informational' | 'commercial' | 'mixed'

const COMMERCIAL = /패키지|특가|가격|예약|견적|할인|프로모|세일|출발가|홀세일|단체|맞춤\s*여행|여행사/i
const INFORMATIONAL = /날씨|환율|비자|입국|시차|우기|성수기|준비물|짐|팁|교통|이동|맛집|관광지|일정|코스|지도|안전|병원|약/i

export function classifySearchIntent(text: string): SearchIntent {
  const t = text.trim()
  if (!t) return 'mixed'
  const c = COMMERCIAL.test(t)
  const i = INFORMATIONAL.test(t)
  if (c && i) return 'mixed'
  if (c) return 'commercial'
  if (i) return 'informational'
  return 'mixed'
}

/** 발행 큐 가중치용: 정보성 비중 목표(0.7)에 맞춰 우선순위 보정 (-5 ~ +5) */
export function intentPriorityDelta(intent: SearchIntent): number {
  if (intent === 'informational') return 5
  if (intent === 'commercial') return -2
  return 0
}
