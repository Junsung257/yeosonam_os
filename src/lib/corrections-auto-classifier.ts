/**
 * @file corrections-auto-classifier.ts — extractions_corrections 규칙 기반 자동 분류 (LLM 0)
 *
 * 박제 사유 (P10-5, 2026-05-13):
 * 사장님 정정 / V2 실패 가 extractions_corrections 에 누적되지만 category 가
 * generic 'parse_failure' / 'v2_cross_validation_failure' 만 박혀 있어 반복 오류
 * 패턴 식별 어려움. 정규식 + field_path 기반 자동 분류로 reflexion 검색 정확도 ↑.
 */

export type CorrectionCategory =
  | 'PRICE_MISMATCH'
  | 'MISSING_HOTEL'
  | 'REGION_MISALIGNMENT'
  | 'DATE_ERROR'
  | 'LEAK_PATTERN'
  | 'SCHEMA_MALFORMED'
  | 'AIRLINE_MISMATCH'
  | 'ANTI_PATTERN'
  | 'PARSE_FAILURE';

export interface CorrectionInput {
  field_path?: string | null;
  reflection?: string | null;
  before_value?: string | null;
  after_value?: string | null;
  category?: string | null;
}

export interface ClassifyResult {
  category: CorrectionCategory;
  severity: 'critical' | 'high' | 'medium' | 'low';
  matched_rule: string;
}

export function classifyCorrection(input: CorrectionInput): ClassifyResult {
  const field = input.field_path ?? '';
  const reflection = input.reflection ?? '';
  const before = input.before_value ?? '';
  const after = input.after_value ?? '';

  if (/leak|투어비|커미션|마진|컴\s*\d+%|원가|파이널|실명단/.test(reflection)) {
    return { category: 'LEAK_PATTERN', severity: 'critical', matched_rule: 'leak_keyword' };
  }
  if (/^leak\./.test(field)) {
    return { category: 'LEAK_PATTERN', severity: 'critical', matched_rule: 'leak_field_path' };
  }
  if (/v2\.C12_notices_object_array|notices_parsed.*문자열\s*배열|schema/.test(reflection)) {
    return { category: 'SCHEMA_MALFORMED', severity: 'high', matched_rule: 'notices_schema' };
  }
  if (/price|가격|adult_price|child_price/.test(field) || /가격.*오기재|가격.*오류|amount/.test(reflection)) {
    return { category: 'PRICE_MISMATCH', severity: 'high', matched_rule: 'price_path' };
  }
  if (/hotel|숙박|accommodation/.test(field) || /숙박\s*누락|호텔.*비어|hotel.*missing/.test(reflection)) {
    const isMissing = after && (!before || before.length < after.length);
    return { category: 'MISSING_HOTEL', severity: isMissing ? 'high' : 'medium', matched_rule: 'hotel_path' };
  }
  if (/airline|flight_out|flight_in|C32_airline_flight/.test(field) || /항공.*불일치|airline.*mismatch/.test(reflection)) {
    return { category: 'AIRLINE_MISMATCH', severity: 'critical', matched_rule: 'airline_path' };
  }
  if (/date|departure|연도|요일|date_range/.test(field) || /연도.*오추론|날짜.*오류|date.*error/.test(reflection)) {
    return { category: 'DATE_ERROR', severity: 'high', matched_rule: 'date_path' };
  }
  if (/destination|region|C13_destination/.test(field) || /지역.*불일치|region.*mismatch|destination.*regions/.test(reflection)) {
    return { category: 'REGION_MISALIGNMENT', severity: 'medium', matched_rule: 'region_path' };
  }
  if (/^(피하세요|금지|절대\s*안|하지\s*마)/.test(reflection)) {
    return { category: 'ANTI_PATTERN', severity: 'high', matched_rule: 'anti_pattern_prefix' };
  }
  return { category: 'PARSE_FAILURE', severity: 'medium', matched_rule: 'fallback' };
}

export function classifyBatch(
  inputs: CorrectionInput[],
): Array<{ input: CorrectionInput; result: ClassifyResult; needsUpdate: boolean }> {
  return inputs.map(input => {
    const result = classifyCorrection(input);
    const fallbackCategories = new Set(['parse_failure', 'v2_cross_validation_failure', 'low_confidence']);
    const needsUpdate = !input.category || fallbackCategories.has(input.category);
    return { input, result, needsUpdate };
  });
}
