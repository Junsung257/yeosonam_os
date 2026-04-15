/**
 * @file ai-consistency-checker.ts
 * @description AI 생성 카피/블로그가 원문과 모순되는지 감지 (regex only, 토큰 0)
 *
 * 검사 항목:
 *   1. 카피가 "추가비용 없음"/"노옵션" 단언 → 원문에 guide_tip/singel_supplement 있으면 conflict
 *   2. 카피가 "5성급"/"럭셔리" → 원문에 해당 등급 표시 없으면 conflict
 *   3. 카피 가격 숫자 → 원문 최저가 ±10% 이내인지
 *   4. 카피가 "왕복 항공료 포함" → 원문 inclusions 미명시 시 conflict
 *   5. 카피가 "노팁" → 원문에 매너팁/기사팁 excludes 있으면 conflict
 */

export type ConsistencyConflict = {
  rule: string;
  reason: string;
  evidence_in_copy?: string;
  evidence_in_raw?: string | null;
};

export interface ConsistencyResult {
  severity: 'high' | 'low' | 'none';
  conflicts: ConsistencyConflict[];
  suggestions: string[];
}

export interface CheckInput {
  /** AI가 생성한 카피 (마케팅 카피/블로그/카드뉴스 슬라이드 텍스트) */
  generatedCopy: string;
  /** 원본 상품 텍스트 (rawText 또는 inclusions+excludes+notices 조합) */
  rawText: string;
  /** 상품 최저가 (숫자 검증용). 없으면 가격 검증 skip */
  minPrice?: number | null;
  /** 정규화된 추가요금 배열 */
  surcharges?: Array<{ kind: string; note: string; amount_krw?: number | null }>;
}

// 금액 추출 regex (만원, 원, $)
const PRICE_RE = /(\d[\d,]{2,})\s*원|(\d+(?:\.\d+)?)\s*만원|\$\s*(\d+)/g;

function extractPrices(text: string): number[] {
  const prices: number[] = [];
  let m;
  PRICE_RE.lastIndex = 0;
  while ((m = PRICE_RE.exec(text)) !== null) {
    if (m[1]) {
      const n = parseInt(m[1].replace(/,/g, ''), 10);
      if (!isNaN(n) && n >= 10000) prices.push(n);
    } else if (m[2]) {
      prices.push(Math.round(parseFloat(m[2]) * 10000));
    } else if (m[3]) {
      prices.push(parseInt(m[3], 10) * 1300); // 달러 대략 환산
    }
  }
  return prices;
}

export function checkAiCopyConsistency(input: CheckInput): ConsistencyResult {
  const conflicts: ConsistencyConflict[] = [];
  const suggestions: string[] = [];
  const copy = input.generatedCopy ?? '';
  const raw = input.rawText ?? '';
  const surcharges = input.surcharges ?? [];

  // 1) "추가비용 없음"/"노옵션"/"팁 포함" 단언 vs 추가요금 존재
  const noCostClaim = /(추가\s*비용\s*없음|노\s*옵션|노\s*팁|팁\s*포함|완전\s*포함)/i.test(copy);
  const hasGuideTip = surcharges.some(s => s.kind === 'guide' && (s.amount_krw ?? 0) > 0);
  const hasSingleCharge = surcharges.some(s => s.kind === 'single' && (s.amount_krw ?? 0) > 0);
  const rawHasTipExc = /(기사\s*\/\s*가이드|매너팁|가이드\s*팁).*?(\$\d+|만원|원)/i.test(raw);

  if (noCostClaim && (hasGuideTip || hasSingleCharge || rawHasTipExc)) {
    conflicts.push({
      rule: 'no_cost_claim_conflict',
      reason: '카피에 "추가비용 없음/노옵션/팁 포함" 단언이 있으나 원문에 가이드팁·싱글차지·매너팁이 명시됨',
      evidence_in_copy: (copy.match(/(추가\s*비용\s*없음|노\s*옵션|노\s*팁|팁\s*포함|완전\s*포함)/i) || [])[0],
      evidence_in_raw: rawHasTipExc ? raw.match(/(기사\s*\/\s*가이드|매너팁|가이드\s*팁).*/i)?.[0]?.slice(0, 80) : null,
    });
    suggestions.push('"완전 포함" 대신 "여행자보험·식사 포함 (기사/가이드 경비 별도)" 등 구체 명시 권장');
  }

  // 2) 호텔 등급 과장
  const copyHotelGrade = copy.match(/(\d)\s*성급|럭셔리|5\s*star/i);
  if (copyHotelGrade) {
    const grade = copyHotelGrade[1] ? parseInt(copyHotelGrade[1], 10) : 5;
    const rawHasGrade = new RegExp(`${grade}\\s*성|${grade}\\s*star|럭셔리|리조트`, 'i').test(raw);
    if (!rawHasGrade && grade >= 4) {
      conflicts.push({
        rule: 'hotel_grade_overclaim',
        reason: `카피의 "${grade}성급/럭셔리" 표현이 원문에서 확인되지 않음`,
        evidence_in_copy: copyHotelGrade[0],
        evidence_in_raw: null,
      });
      suggestions.push('호텔 등급은 원문에 명시된 경우에만 표기. 불확실하면 "특급 호텔" 모호 표현 사용');
    }
  }

  // 3) 가격 불일치
  if (typeof input.minPrice === 'number' && input.minPrice > 0) {
    const copyPrices = extractPrices(copy);
    for (const cp of copyPrices) {
      if (cp < 50_000) continue; // 개별 비용(마사지 $30 등)은 skip
      const diff = Math.abs(cp - input.minPrice) / input.minPrice;
      if (diff > 0.1) {
        conflicts.push({
          rule: 'price_mismatch',
          reason: `카피의 가격 ${cp.toLocaleString()}원이 상품 최저가 ${input.minPrice.toLocaleString()}원과 ${Math.round(diff * 100)}% 차이`,
          evidence_in_copy: String(cp),
        });
        suggestions.push('가격 수치는 DB의 최저가를 직접 인용하거나 "부터" 표기 사용');
      }
    }
  }

  // 4) "왕복 항공료 포함" 주장 vs 원문
  if (/왕복\s*항공/.test(copy) && !/(항공료|항공권|왕복\s*항공)/.test(raw)) {
    conflicts.push({
      rule: 'flight_inclusion_unverified',
      reason: '카피에 "왕복 항공료" 명시되어 있으나 원문에서 확인 불가',
    });
  }

  // 심각도: 카피 단언이 원문 사실과 직접 충돌하면 high, 그 외 low
  const severity: ConsistencyResult['severity'] =
    conflicts.some(c => c.rule === 'no_cost_claim_conflict' || c.rule === 'price_mismatch')
      ? 'high'
      : conflicts.length > 0
        ? 'low'
        : 'none';

  return { severity, conflicts, suggestions };
}
