function parseIntEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseFloatEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** 관리자 부트스트랩 패널·GET ?bootstrap=1 기본값 (쿼리로 덮어쓰기 가능) */
export function getUnmatchedBootstrapEnvDefaults(): {
  minOccurrences: number;
  scoreMin: number;
  scoreMax: number;
} {
  return {
    minOccurrences: Math.max(1, parseIntEnv('UNMATCHED_BOOTSTRAP_MIN_OCCURRENCES', 3)),
    scoreMin: parseFloatEnv('UNMATCHED_BOOTSTRAP_SCORE_MIN', 75),
    scoreMax: parseFloatEnv('UNMATCHED_BOOTSTRAP_SCORE_MAX', 94),
  };
}
