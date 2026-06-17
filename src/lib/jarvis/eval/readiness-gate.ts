export type JarvisReadinessStatus = 'pass' | 'warn' | 'fail';

export interface JarvisReadinessCheck {
  id: string;
  label: string;
  status: JarvisReadinessStatus;
  score: number;
  maxScore: number;
  message: string;
}

export interface JarvisReadinessInput {
  deterministicPassRate: number;
  ragPassRate: number;
  tracePassRate: number;
  traceAverageScore: number;
  liveRagScore: number | null;
  liveRagReadiness: 'ready' | 'watch' | 'blocked' | 'skipped';
  liveRagSearchPassed: boolean | 'skipped';
  typecheckPassed: boolean | 'skipped';
  componentTestsPassed: boolean | 'skipped';
  smokePassed: boolean | 'skipped';
}

export interface JarvisReadinessSummary {
  status: JarvisReadinessStatus;
  score: number;
  maxScore: number;
  checks: JarvisReadinessCheck[];
  blockingChecks: string[];
  warningChecks: string[];
}

function boundedRate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function boundedScore(value: number, maxScore: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(maxScore, value));
}

function rateCheck(
  id: string,
  label: string,
  passRate: number,
  maxScore: number,
): JarvisReadinessCheck {
  const rate = boundedRate(passRate);
  const score = Math.round(rate * maxScore);
  return {
    id,
    label,
    status: rate === 1 ? 'pass' : rate >= 0.95 ? 'warn' : 'fail',
    score,
    maxScore,
    message: `${Math.round(rate * 100)}% pass rate`,
  };
}

function booleanCheck(
  id: string,
  label: string,
  passed: boolean | 'skipped',
  maxScore: number,
): JarvisReadinessCheck {
  if (passed === 'skipped') {
    return {
      id,
      label,
      status: 'warn',
      score: Math.floor(maxScore * 0.6),
      maxScore,
      message: 'skipped in lightweight snapshot',
    };
  }

  return {
    id,
    label,
    status: passed ? 'pass' : 'fail',
    score: passed ? maxScore : 0,
    maxScore,
    message: passed ? 'passed' : 'failed',
  };
}

function liveRagCheck(input: JarvisReadinessInput): JarvisReadinessCheck {
  const maxScore = 15;
  if (input.liveRagReadiness === 'skipped' || input.liveRagScore === null) {
    return {
      id: 'live-rag-index',
      label: 'Live RAG index audit',
      status: 'warn',
      score: 8,
      maxScore,
      message: 'skipped; DB audit evidence missing',
    };
  }

  const score = Math.round((boundedScore(input.liveRagScore, 100) / 100) * maxScore);
  const status: JarvisReadinessStatus = input.liveRagReadiness === 'blocked'
    ? 'fail'
    : input.liveRagReadiness === 'watch'
      ? 'warn'
      : 'pass';

  return {
    id: 'live-rag-index',
    label: 'Live RAG index audit',
    status,
    score,
    maxScore,
    message: `${input.liveRagScore}/100 ${input.liveRagReadiness}`,
  };
}

export function evaluateJarvisReadiness(input: JarvisReadinessInput): JarvisReadinessSummary {
  const traceRate = boundedRate(input.tracePassRate);
  const traceMaxScore = 15;
  const traceScore = Math.round(
    ((traceRate * 0.7) + ((boundedScore(input.traceAverageScore, 100) / 100) * 0.3)) * traceMaxScore,
  );

  const checks: JarvisReadinessCheck[] = [
    rateCheck('deterministic-golden', 'Deterministic Jarvis golden set', input.deterministicPassRate, 20),
    rateCheck('rag-golden', 'RAG grounding golden set', input.ragPassRate, 15),
    {
      id: 'trace-golden',
      label: 'Trace grading golden set',
      status: input.tracePassRate === 1 && input.traceAverageScore >= 95 ? 'pass' : input.tracePassRate >= 0.95 ? 'warn' : 'fail',
      score: traceScore,
      maxScore: traceMaxScore,
      message: `${Math.round(traceRate * 100)}% pass rate, avg ${input.traceAverageScore.toFixed(1)}/100`,
    },
    liveRagCheck(input),
    booleanCheck('live-rag-retrieval', 'Live RAG retrieval eval', input.liveRagSearchPassed, 10),
    booleanCheck('jarvis-v2-smoke', 'Jarvis V2 smoke tests', input.smokePassed, 10),
    booleanCheck('typecheck', 'TypeScript typecheck', input.typecheckPassed, 15),
    booleanCheck('ui-regression', 'Jarvis UI/audit regression tests', input.componentTestsPassed, 10),
  ];

  const score = checks.reduce((sum, check) => sum + check.score, 0);
  const maxScore = checks.reduce((sum, check) => sum + check.maxScore, 0);
  const blockingChecks = checks.filter((check) => check.status === 'fail').map((check) => check.id);
  const warningChecks = checks.filter((check) => check.status === 'warn').map((check) => check.id);
  const status: JarvisReadinessStatus = blockingChecks.length > 0
    ? 'fail'
    : warningChecks.length > 0
      ? 'warn'
      : 'pass';

  return {
    status,
    score,
    maxScore,
    checks,
    blockingChecks,
    warningChecks,
  };
}
