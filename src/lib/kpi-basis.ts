/**
 * KPI Basis — 매출/수익 산출 기준일의 단일 추상화
 *
 * 여소남 OS의 모든 어드민 KPI 페이지가 같은 산식을 공유하도록 강제하는
 * 작은 라이브러리. "예약 기준 vs 매출 인식 기준" 같은 정책 차이를
 * **데이터 정의가 아닌 메타데이터**로 명시한다.
 *
 * 사용처:
 *  - /admin/affiliate-analytics   (commission 기본 + accounting 토글)
 *  - /admin/content-analytics     (P1 — 도입 예정)
 *  - /admin/marketing             (P1 — 도입 예정)
 *  - 메인 /admin 의 V4 함수도 이 메타와 일치
 *
 * 새 페이지에서 dual-basis 지원하기:
 *  1) 페이지에서 useState<KPIBasis>('commission')
 *  2) <KPIBasisToggle> 컴포넌트로 UI 표시
 *  3) API 호출에 ?basis=<basis> 쿼리파라미터 부착
 *  4) 서버에서 bookingMonthByBasis() / bookingPassesBasis()로 분기
 *
 * IFRS 15 / ASC 606 회계 표준: 출발일 기준 매출 인식이 글로벌 표준.
 * 단, 어필리에이트 정산 정책 등 비회계 KPI는 commission(생성일) 기준이 자연스럽다.
 */

export type KPIBasis = 'commission' | 'accounting';

export interface KPIBasisMeta {
  id: KPIBasis;
  label: string;            // 풀 라벨 (드롭다운/툴팁)
  shortLabel: string;       // 짧은 배지 (KPI 카드 옆)
  description: string;      // 사용 가이드
  dateField: 'created_at' | 'departure_date';
  excludeCancelled: boolean;
}

export const KPI_BASIS_OPTIONS: KPIBasisMeta[] = [
  {
    id: 'commission',
    label: '예약 기준 (생성일)',
    shortLabel: '예약',
    description: '예약 생성일 기준. 어필리에이트 정산·마케팅·영업 KPI에 적합. 취소건 포함.',
    dateField: 'created_at',
    excludeCancelled: false,
  },
  {
    id: 'accounting',
    label: '매출 인식 기준 (출발일)',
    shortLabel: '매출',
    description: '출발일 기준 (IFRS 15 / ASC 606). 회계·재무 KPI. 취소건 자동 제외.',
    dateField: 'departure_date',
    excludeCancelled: true,
  },
];

export const DEFAULT_KPI_BASIS: KPIBasis = 'commission';

export function getBasisMeta(basis: KPIBasis | string | null | undefined): KPIBasisMeta {
  return KPI_BASIS_OPTIONS.find(o => o.id === basis) ?? KPI_BASIS_OPTIONS[0];
}

/** 쿼리스트링 등 외부 입력에서 안전하게 KPIBasis 파싱 */
export function parseBasis(raw: string | null | undefined): KPIBasis {
  return raw === 'accounting' ? 'accounting' : 'commission';
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 예약 행의 month bucket (YYYY-MM) — basis 가 결정한 dateField 사용.
 * - commission: created_at 의 KST 월
 * - accounting: departure_date 의 월 (이미 date 타입)
 *
 * 취소건은 accounting basis 에서 자동 제외 (null 반환).
 */
export function bookingMonthByBasis(
  row: { created_at?: string | null; departure_date?: string | null; status?: string | null },
  basis: KPIBasis,
): string | null {
  const meta = getBasisMeta(basis);
  if (meta.excludeCancelled && row.status === 'cancelled') return null;

  if (meta.dateField === 'departure_date') {
    if (!row.departure_date) return null;
    return row.departure_date.slice(0, 7);
  }
  // commission: created_at KST 월
  if (!row.created_at) return null;
  const t = new Date(row.created_at).getTime();
  if (Number.isNaN(t)) return null;
  const kst = new Date(t + KST_OFFSET_MS);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 행이 현재 basis의 상태 필터를 통과하는지 (취소건 제외 여부 등). */
export function bookingPassesBasis(
  row: { status?: string | null },
  basis: KPIBasis,
): boolean {
  const meta = getBasisMeta(basis);
  if (meta.excludeCancelled && row.status === 'cancelled') return false;
  return true;
}

/**
 * Supabase select 시 필요한 컬럼 목록.
 * basis가 accounting 이면 departure_date + status 가 필수.
 * 두 basis 모두 지원하려면 둘 다 select 해야 함.
 */
export const BASIS_REQUIRED_COLUMNS = ['created_at', 'departure_date', 'status'] as const;

/**
 * 월별 윈도우 키 생성 (YYYY-MM, N개, 최신이 마지막).
 * 두 basis가 같은 윈도우 정의를 공유.
 */
export function generateMonthKeys(months: number, anchor = new Date()): string[] {
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}
