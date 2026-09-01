import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCommitSafeSummary, summarizePromptfooOutput } from './summary.mjs';

test('summarizes results without retaining prompts or model outputs', () => {
  const aggregate = summarizePromptfooOutput({
    results: { results: [
      { success: true, score: 1, cost: 0.01, testCase: { description: 'a' }, response: { output: 'secret raw output' } },
      { success: false, score: 0, cost: 0.02, testCase: { description: 'b' } },
    ] },
  }, 2);
  assert.deepEqual(aggregate, { status: 'complete', expectedCases: 2, observedCases: 2, passed: 1, failed: 1, score: 1, costUsd: 0.03 });
  assert.equal(JSON.stringify(aggregate).includes('secret raw output'), false);
});

test('candidate status requires smoke and both 33-case runs to pass', () => {
  const manifests = [
    { providerId: 'challenger', phase: 'smoke', runId: 0, rawSha256: 'a', aggregate: { status: 'complete', passed: 3, costUsd: 0 } },
    { providerId: 'challenger', phase: 'full', runId: 1, rawSha256: 'b', aggregate: { status: 'complete', passed: 33, costUsd: 0 } },
    { providerId: 'challenger', phase: 'full', runId: 2, rawSha256: 'c', aggregate: { status: 'complete', passed: 33, costUsd: 0 } },
  ];
  const summary = buildCommitSafeSummary({ policyHash: 'p', fixtureHash: 'f', promptHash: 'q', manifests });
  assert.equal(summary.providers[0].decision, 'candidate');
  assert.equal(summary.decision.championChanged, false);
  assert.equal(summary.decision.productionProviderMutationAllowed, false);
  assert.equal(JSON.stringify(summary).includes('candidate_answer'), false);
});

test('does not fabricate a zero cost when the provider reports no cost', () => {
  const aggregate = summarizePromptfooOutput({ results: { results: [{ success: true, score: 1 }] } }, 1);
  assert.equal(aggregate.costUsd, null);
});
