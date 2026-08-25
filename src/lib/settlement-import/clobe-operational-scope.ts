import { parseTravelSettlementMemo } from './bank-statement-parser';
import { resolveClobeTransactionAuthority } from './clobe-transaction-authority';

export interface ClobeMemoRow {
  memo?: string | null;
  source?: string | null;
  external_provider?: string | null;
  source_metadata?: Record<string, unknown> | null;
}

/**
 * Clobe 메모가 현재 예약·정산 워크플로에 들어올 수 있는 여행키인지 판정한다.
 * 원본 거래 보존 여부와는 무관하며, 운영 화면과 현금 정산 projection의 경계로만 쓴다.
 */
export function hasClobeTravelMemo(row: ClobeMemoRow): boolean {
  const authority = resolveClobeTransactionAuthority(row);
  return parseTravelSettlementMemo(authority.effectiveMemo) !== null;
}

export function splitClobeOperationalRows<T extends ClobeMemoRow>(rows: T[]): {
  travel: T[];
  memoReview: T[];
} {
  const travel: T[] = [];
  const memoReview: T[] = [];

  for (const row of rows) {
    (hasClobeTravelMemo(row) ? travel : memoReview).push(row);
  }

  return { travel, memoReview };
}
