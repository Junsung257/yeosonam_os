/**
 * @file pricing.ts
 * @description 가격/추가요금 정규화 타입 — 포스터·랜딩·블로그 간 일관성 보장
 *
 * 기존에는 guide_tip, single_supplement, small_group_surcharge가 string으로,
 * surcharges[]는 {amount_krw, amount_usd}로 혼재했음.
 * → 하나의 Surcharge 배열로 통합, kind 필드로 구분.
 */

/** 추가요금 종류 */
export type SurchargeKind =
  | 'guide'        // 기사/가이드 경비
  | 'single'       // 싱글 차지
  | 'small_group'  // 소규모 할증
  | 'festival'     // 축제/공휴일 할증
  | 'hotel'        // 특정 호텔 써차지
  | 'meal'         // 의무 식사/디너
  | 'other';

/** 정규화된 추가요금 단일 항목 */
export interface Surcharge {
  /** 원화 금액 (달러만 있으면 환율 미적용, null) */
  amount_krw: number | null;
  /** 달러 원문 보존용 (있으면 amount_krw와 병기) */
  amount_usd?: number | null;
  /** 적용 기간 (예: "4/28-5/5", "전 일정", "4/30") */
  period?: string | null;
  /** 원문 설명 (예: "달랏 라사피네트 룸당/박당") */
  note: string;
  /** 분류 */
  kind: SurchargeKind;
  /** 단위 (예: "인", "룸당/박당", "박") */
  unit?: string | null;
}

/** Surcharge 배열을 kind별로 그룹핑한 뷰 (렌더링 편의용) */
export interface SurchargeGroups {
  guide: Surcharge[];
  single: Surcharge[];
  small_group: Surcharge[];
  festival: Surcharge[];
  hotel: Surcharge[];
  meal: Surcharge[];
  other: Surcharge[];
}

/** 문자열에서 금액/단위 추출 (예: "8만원/인" → {krw: 80000, unit: "인"}) */
export function parseAmountString(raw: string): {
  amount_krw: number | null;
  amount_usd: number | null;
  unit: string | null;
} {
  if (!raw) return { amount_krw: null, amount_usd: null, unit: null };

  // 달러 우선 ($40, $40/인)
  const usdMatch = raw.match(/\$\s*(\d+(?:\.\d+)?)/);
  const usd = usdMatch ? Math.round(parseFloat(usdMatch[1])) : null;

  // 원화 (8만원, 80,000원, 12만원/인/박)
  let krw: number | null = null;
  const manMatch = raw.match(/(\d+(?:\.\d+)?)\s*만원/);
  const wonMatch = raw.match(/(\d[\d,]*)\s*원/);
  if (manMatch) {
    krw = Math.round(parseFloat(manMatch[1]) * 10000);
  } else if (wonMatch) {
    krw = parseInt(wonMatch[1].replace(/,/g, ''), 10);
    if (Number.isNaN(krw)) krw = null;
  }

  // 단위 (우선순위: 복합 → 룸당 → 인/박 단독)
  let unit: string | null = null;
  if (/\/\s*인\s*\/\s*박/.test(raw)) unit = '인/박';
  else if (/룸당/.test(raw)) unit = '룸당';
  else if (/\/\s*인/.test(raw) || /인당/.test(raw)) unit = '인';
  else if (/\/\s*박/.test(raw) || /박당/.test(raw)) unit = '박';

  return { amount_krw: krw, amount_usd: usd, unit };
}

/** 문자열 필드를 Surcharge 객체로 변환 */
export function toSurcharge(raw: string, kind: SurchargeKind): Surcharge | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '포함' || trimmed === '-' || trimmed === 'null') return null;

  const { amount_krw, amount_usd, unit } = parseAmountString(trimmed);

  // 금액 못 읽었고 특수 값도 아니면 original을 note로만 보존
  return {
    amount_krw,
    amount_usd,
    period: null,
    note: trimmed,
    kind,
    unit,
  };
}

/** Surcharge 배열을 kind별로 그룹핑 */
export function groupSurcharges(surcharges: Surcharge[]): SurchargeGroups {
  const groups: SurchargeGroups = {
    guide: [], single: [], small_group: [], festival: [], hotel: [], meal: [], other: [],
  };
  for (const s of surcharges) {
    (groups[s.kind] ?? groups.other).push(s);
  }
  return groups;
}
