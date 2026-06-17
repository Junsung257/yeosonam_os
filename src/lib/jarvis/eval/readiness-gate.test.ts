import { describe, expect, it } from 'vitest';
import { evaluateJarvisReadiness } from './readiness-gate';
import type { JarvisReadinessInput } from './readiness-gate';

const PASSING_INPUT: JarvisReadinessInput = {
  deterministicPassRate: 1,
  ragPassRate: 1,
  tracePassRate: 1,
  traceAverageScore: 98,
  liveRagScore: 99,
  liveRagReadiness: 'ready',
  liveRagSearchPassed: true,
  typecheckPassed: true,
  componentTestsPassed: true,
  smokePassed: true,
};

describe('Jarvis readiness gate', () => {
  it('passes when golden sets, live RAG, smoke, typecheck, and UI regression all pass', () => {
    const summary = evaluateJarvisReadiness(PASSING_INPUT);

    expect(summary.status).toBe('pass');
    expect(summary.maxScore).toBe(110);
    expect(summary.score).toBeGreaterThanOrEqual(109);
    expect(summary.blockingChecks).toEqual([]);
    expect(summary.warningChecks).toEqual([]);
  });

  it('warns when live RAG audit is skipped but deterministic checks pass', () => {
    const summary = evaluateJarvisReadiness({
      ...PASSING_INPUT,
      liveRagScore: null,
      liveRagReadiness: 'skipped',
    });

    expect(summary.status).toBe('warn');
    expect(summary.warningChecks).toEqual(['live-rag-index']);
    expect(summary.blockingChecks).toEqual([]);
  });

  it('warns instead of passing when heavy release checks are skipped', () => {
    const summary = evaluateJarvisReadiness({
      ...PASSING_INPUT,
      typecheckPassed: 'skipped',
      componentTestsPassed: 'skipped',
      smokePassed: 'skipped',
      liveRagSearchPassed: 'skipped',
    });

    expect(summary.status).toBe('warn');
    expect(summary.warningChecks).toEqual(['live-rag-retrieval', 'jarvis-v2-smoke', 'typecheck', 'ui-regression']);
    expect(summary.blockingChecks).toEqual([]);
  });

  it('fails on a blocked live RAG audit or failed smoke test', () => {
    const summary = evaluateJarvisReadiness({
      ...PASSING_INPUT,
      liveRagScore: 70,
      liveRagReadiness: 'blocked',
      liveRagSearchPassed: false,
      smokePassed: false,
    });

    expect(summary.status).toBe('fail');
    expect(summary.blockingChecks).toEqual(['live-rag-index', 'live-rag-retrieval', 'jarvis-v2-smoke']);
  });
});
