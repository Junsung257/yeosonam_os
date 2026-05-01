/**
 * 출금 자동 제안용 subset-sum (knapsack) 풀이.
 *
 * 출금 거래 amount 가 target 일 때, 미정산 booking N 개 중
 * 합계가 target ± tolerance 인 부분집합을 찾는다.
 *
 * 알고리즘: pruning + 큰 것부터 backtracking. N≤30 보통 ~ms.
 * - first-fit: 첫 매치 1개 반환 (운영자가 사후 확인)
 * - 시간 제한 (deadlineMs) 으로 worst-case 안전.
 */

export interface SubsetItem {
  id: string;
  amount: number;
}

export interface SubsetMatch {
  items: SubsetItem[];
  total: number;
  diff: number;
}

export interface FindSubsetOptions {
  tolerance?: number;
  deadlineMs?: number;
  maxItems?: number;
}

const DEFAULT_TOLERANCE = 5_000;
const DEFAULT_DEADLINE = 250;
const DEFAULT_MAX_ITEMS = 12;

/**
 * 합계가 target ± tolerance 인 부분집합 (첫 매치 1개).
 * - 큰 amount 부터 시도해 후속 후보가 적게 남도록 prune
 * - target 초과 시 즉시 컷
 * - deadlineMs 초과 시 best-effort 반환 (근접 매치 우선)
 */
export function findSubsetSum(
  items: SubsetItem[],
  target: number,
  options: FindSubsetOptions = {},
): SubsetMatch | null {
  if (target <= 0 || items.length === 0) return null;

  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const deadline = Date.now() + (options.deadlineMs ?? DEFAULT_DEADLINE);
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;

  // 1) 정확/근사 단일 항목 빠른 path
  const single = items
    .filter(i => Math.abs(i.amount - target) <= tolerance)
    .sort((a, b) => Math.abs(a.amount - target) - Math.abs(b.amount - target))[0];
  if (single) {
    return { items: [single], total: single.amount, diff: single.amount - target };
  }

  const sorted = [...items].sort((a, b) => b.amount - a.amount);
  let best: SubsetMatch | null = null;
  let bestDiff = Infinity;

  function backtrack(idx: number, picked: SubsetItem[], sum: number, remaining: number): void {
    if (Date.now() > deadline) return;
    if (sum > target + tolerance) return;          // 초과 컷
    if (sum + remaining < target - tolerance) return; // 도달 불가 컷
    if (picked.length > maxItems) return;

    const diff = Math.abs(sum - target);
    if (diff <= tolerance) {
      if (diff < bestDiff) {
        best = { items: [...picked], total: sum, diff: sum - target };
        bestDiff = diff;
      }
      if (diff === 0) return;                     // 정확 매치 즉시 종료
    }
    if (idx >= sorted.length) return;

    const next = sorted[idx];
    const rest = remaining - next.amount;
    // include
    picked.push(next);
    backtrack(idx + 1, picked, sum + next.amount, rest);
    picked.pop();
    // exclude
    backtrack(idx + 1, picked, sum, rest);
  }

  const totalRemaining = sorted.reduce((s, x) => s + x.amount, 0);
  backtrack(0, [], 0, totalRemaining);

  return best;
}
