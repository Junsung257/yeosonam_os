import type { JarvisReadinessStatus } from './readiness-gate';

export type AllScenarioReadinessStatus = 'pass' | 'warn' | 'fail';

export interface AllScenarioReadinessInput {
  jarvisReadinessScore: number;
  jarvisReadinessMaxScore: number;
  jarvisReadinessStatus: JarvisReadinessStatus;
  customerInquiryScore: number;
  customerInquiryStatus: 'pass' | 'warn' | 'fail';
  autopilotHitlPassed: boolean | 'skipped';
  freeTravelScore: number;
  freeTravelStatus: 'pass' | 'warn' | 'fail';
  freeTravelP0Failures: number;
  liveRagScore: number | null;
  liveRagReadiness: 'ready' | 'watch' | 'blocked' | 'skipped';
}

export interface AllScenarioSectionScore {
  id: string;
  label: string;
  status: AllScenarioReadinessStatus;
  score: number;
  maxScore: number;
  message: string;
}

export interface AllScenarioReadinessSummary {
  ok: boolean;
  status: AllScenarioReadinessStatus;
  score: number;
  maxScore: 100;
  passThreshold: 95;
  sections: AllScenarioSectionScore[];
  blockingSections: string[];
  warningSections: string[];
}

function boundedPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function scoreFromPercent(percent: number, maxScore: number): number {
  return Math.round((boundedPercent(percent) / 100) * maxScore);
}

function scoreFromRatio(score: number, maxScore: number, weight: number): number {
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) return 0;
  return Math.round((Math.max(0, Math.min(score, maxScore)) / maxScore) * weight);
}

function statusFromSource(sourceStatus: AllScenarioReadinessStatus): AllScenarioReadinessStatus {
  return sourceStatus;
}

export function evaluateAllScenarioReadiness(
  input: AllScenarioReadinessInput,
): AllScenarioReadinessSummary {
  const liveRagSkipped = input.liveRagReadiness === 'skipped' || input.liveRagScore === null;
  const liveRagNumericScore = typeof input.liveRagScore === 'number' ? input.liveRagScore : 0;
  const liveRagStatus: AllScenarioReadinessStatus = input.liveRagReadiness === 'blocked'
    ? 'fail'
    : liveRagSkipped || input.liveRagReadiness === 'watch'
      ? 'warn'
      : 'pass';

  const sections: AllScenarioSectionScore[] = [
    {
      id: 'jarvis-core-readiness',
      label: 'Jarvis core release gate',
      status: statusFromSource(input.jarvisReadinessStatus),
      score: scoreFromRatio(input.jarvisReadinessScore, input.jarvisReadinessMaxScore, 40),
      maxScore: 40,
      message: `${input.jarvisReadinessScore}/${input.jarvisReadinessMaxScore}`,
    },
    {
      id: 'customer-inquiry-automation',
      label: 'Customer inquiry automation',
      status: statusFromSource(input.customerInquiryStatus),
      score: scoreFromPercent(input.customerInquiryScore, 20),
      maxScore: 20,
      message: `${boundedPercent(input.customerInquiryScore)}/100`,
    },
    {
      id: 'autopilot-hitl',
      label: 'Autopilot and HITL controls',
      status: input.autopilotHitlPassed === true ? 'pass' : input.autopilotHitlPassed === 'skipped' ? 'warn' : 'fail',
      score: input.autopilotHitlPassed === true ? 15 : input.autopilotHitlPassed === 'skipped' ? 9 : 0,
      maxScore: 15,
      message: input.autopilotHitlPassed === true
        ? 'agent-action registry and HITL tests passed'
        : input.autopilotHitlPassed === 'skipped'
          ? 'skipped in lightweight snapshot'
          : 'agent-action registry or HITL tests failed',
    },
    {
      id: 'free-travel-100',
      label: 'Free-travel 100 scenarios',
      status: input.freeTravelP0Failures > 0 ? 'fail' : statusFromSource(input.freeTravelStatus),
      score: scoreFromPercent(input.freeTravelScore, 20),
      maxScore: 20,
      message: `${boundedPercent(input.freeTravelScore)}/100, P0 failures=${input.freeTravelP0Failures}`,
    },
    {
      id: 'live-rag-index',
      label: 'Live RAG index',
      status: liveRagStatus,
      score: liveRagSkipped ? 3 : scoreFromPercent(liveRagNumericScore, 5),
      maxScore: 5,
      message: liveRagSkipped ? 'skipped; DB audit evidence missing' : `${input.liveRagScore}/100 ${input.liveRagReadiness}`,
    },
  ];

  const score = sections.reduce((sum, section) => sum + section.score, 0);
  const blockingSections = sections
    .filter((section) => section.status === 'fail')
    .map((section) => section.id);
  const warningSections = sections
    .filter((section) => section.status === 'warn')
    .map((section) => section.id);
  const status: AllScenarioReadinessStatus = blockingSections.length > 0 || score < 95
    ? 'fail'
    : warningSections.length > 0
      ? 'warn'
      : 'pass';

  return {
    ok: status === 'pass',
    status,
    score,
    maxScore: 100,
    passThreshold: 95,
    sections,
    blockingSections,
    warningSections,
  };
}
