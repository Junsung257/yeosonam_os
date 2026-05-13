/**
 * @file generative-verifier.ts — P11-6 Generative Verifier Critique (Trust-but-Verify pattern)
 *
 * 박제 사유 (2026-05-13, arxiv 2508.16665):
 * V2 cross-validation 결과를 자연어 critique 로 변환 → reflection-memory.ts 에
 * inject. discriminative score (passed/failed) → generative critique 으로 확장.
 *
 * 출력 예:
 *   "이번 등록은 C19 (가격 일관성) 실패: tier 간 가격 2.3배 차이로 통화 불일치 의심.
 *    원문 재확인 권장 (USD vs KRW 혼재 여부)."
 */

import type { ValidationCheck } from '@/lib/parser';

export interface GenerativeCritique {
  severity:     'critical' | 'high' | 'medium' | 'low';
  category:     string;
  natural_text: string;        // reflection-memory inject 용
  recommended_action: string;  // 사장님 action hint
  rule_id:      string;
}

const RULE_DESCRIPTIONS: Record<string, { category: string; action: string }> = {
  C1_duration_days_match:        { category: '일정 정합성', action: 'duration vs days.length 재확인' },
  C2_dates_in_future:            { category: '날짜 검증',   action: '연도 추론 정책 점검 — 과거 날짜 차단' },
  C3_notices_four_types:         { category: 'schema 형식', action: 'notices_parsed 객체 배열로 재추출' },
  C4_flights_both_legs:          { category: '항공편',      action: 'flight_out / flight_in 둘 다 추출' },
  C9_first_last_day_flight:      { category: '항공편',      action: 'DAY 1 / 마지막 DAY 항공편 추가' },
  C10_airline_extracted:         { category: '항공사',      action: 'airline 코드 추출' },
  C11_surcharges_no_commission:  { category: 'Leak 차단',   action: 'surcharges 에서 커미션/마진 패턴 제거' },
  C12_notices_object_array:      { category: 'schema 형식', action: 'notices schema 객체 배열 강제' },
  C13_destination_in_itinerary:  { category: '지역 정합성', action: 'destination ↔ regions 매치' },
  C16_price_in_range:            { category: '가격 범위',   action: '가격 1만원~5천만원 범위 검증' },
  C18_dates_within_365d:         { category: '날짜 검증',   action: '출발일 1년 이내 검증' },
  C19_price_consistency:         { category: '가격 일관성', action: 'tier 간 가격 차 50% 이내 검증' },
  C22_inclusion_item_length:     { category: 'schema',      action: 'inclusions 항목 200자 이내 분할' },
  C23_notice_min_length:         { category: 'schema',      action: 'notices text 20자+ 확보' },
  C26_destination_korean:        { category: '한국어',      action: 'destination 한국어 도시명 검증' },
  C32_airline_flight_prefix_match: { category: '항공 매치', action: 'airline ↔ flight IATA prefix 일치' },
  C36_currency_consistency:      { category: '통화',        action: 'tier 가격 통화 일관성 (KRW)' },
  C37_first_day_korea:           { category: '출발지',      action: 'DAY1 한국 공항 검증' },
  C40_day_sequence_continuous:   { category: '일정 순서',   action: 'day 번호 1..N 연속 검증' },
};

/** ValidationCheck (passed=false) → 자연어 critique */
export function generateCritique(check: ValidationCheck): GenerativeCritique {
  const desc = RULE_DESCRIPTIONS[check.id] ?? { category: '검증', action: '원문 재확인' };
  return {
    severity:     check.severity,
    category:     desc.category,
    rule_id:      check.id,
    natural_text: `[${desc.category}] ${check.id} 실패: ${check.message}`,
    recommended_action: desc.action,
  };
}

/** 다수 failed checks → 통합 critique 텍스트 (reflection inject 용) */
export function buildAggregatedCritique(failedChecks: ValidationCheck[]): string {
  if (failedChecks.length === 0) return '';

  const critiques = failedChecks.map(generateCritique);
  const byCategory = new Map<string, GenerativeCritique[]>();
  for (const c of critiques) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c);
    byCategory.set(c.category, list);
  }

  const lines: string[] = [
    '## V2 검증 critique (자동 생성)',
    '',
  ];

  for (const [category, items] of byCategory) {
    const severityIcon = items.some(i => i.severity === 'critical') ? '🚨' :
                         items.some(i => i.severity === 'high')     ? '⚠️' : '·';
    lines.push(`### ${severityIcon} ${category}`);
    for (const item of items) {
      lines.push(`- **${item.rule_id}**: ${item.natural_text.replace(/^\[.+?\]\s/, '')}`);
      lines.push(`  → 권장: ${item.recommended_action}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/** reflection-memory inject 용 — extractions_corrections 에 박을 reflection 텍스트 */
export function critiqueToReflection(check: ValidationCheck): { reflection: string; field_path: string; category: string; severity: string } {
  const c = generateCritique(check);
  return {
    reflection: `${c.natural_text}\n권장 조치: ${c.recommended_action}`,
    field_path: `v2.${check.id}`,
    category:   c.category,
    severity:   c.severity,
  };
}
