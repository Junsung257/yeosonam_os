/**
 * Frecency = Frequency + Recency — 자주 + 최근 쓴 명령을 위로.
 *
 * Mozilla Firefox 의 frecency 알고리즘 단순화:
 *   - 최근 30일 내 사용 횟수에 시간 가중치
 *   - <1일: 가중치 1.0
 *   - 1~3일: 0.8
 *   - 3~7일: 0.5
 *   - 7~14일: 0.3
 *   - 14~30일: 0.1
 *   - >30일: 0
 *
 * 저장: localStorage.admin.frecency = { [commandId]: number[] of timestamps }
 */

const KEY = 'admin.frecency';
const MAX_HISTORY = 50; // commandId 당 최근 50회까지만 저장
const WINDOW_DAYS = 30;

type FrecencyMap = Record<string, number[]>;

function read(): FrecencyMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function write(m: FrecencyMap) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    // ignore quota errors
  }
}

export function recordUse(commandId: string) {
  const m = read();
  const list = (m[commandId] ?? []).slice(-MAX_HISTORY + 1);
  list.push(Date.now());
  m[commandId] = list;
  write(m);
}

export function getFrecencyScore(commandId: string): number {
  const m = read();
  const list = m[commandId];
  if (!list || list.length === 0) return 0;
  const now = Date.now();
  const dayMs = 86_400_000;
  let score = 0;
  for (const ts of list) {
    const days = (now - ts) / dayMs;
    if (days < 1) score += 1.0;
    else if (days < 3) score += 0.8;
    else if (days < 7) score += 0.5;
    else if (days < 14) score += 0.3;
    else if (days < WINDOW_DAYS) score += 0.1;
  }
  return score;
}

export function clearFrecency() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(KEY);
  }
}
