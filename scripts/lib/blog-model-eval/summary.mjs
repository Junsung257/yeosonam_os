import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function extractPromptfooRows(payload) {
  const candidates = [
    payload?.results?.results,
    payload?.results,
    payload?.eval?.results,
    payload?.table?.body,
  ];
  const rows = candidates.find((candidate) => Array.isArray(candidate));
  if (!rows) return [];
  return rows.map((row, index) => ({
    id: String(
      row?.testCase?.description
      ?? row?.testCase?.metadata?.fixture_description
      ?? row?.description
      ?? row?.metadata?.fixture_description
      ?? `case-${index + 1}`,
    ),
    pass: row?.success === true || row?.pass === true,
    score: Number.isFinite(Number(row?.score)) ? Number(row.score) : null,
    cost: Number.isFinite(Number(row?.cost ?? row?.response?.cost)) && (row?.cost ?? row?.response?.cost) !== null
      ? Number(row?.cost ?? row?.response?.cost)
      : null,
  }));
}

export function summarizePromptfooOutput(payload, expectedCases) {
  const rows = extractPromptfooRows(payload);
  if (rows.length !== expectedCases) {
    return { status: 'raw_schema_or_case_count_invalid', expectedCases, observedCases: rows.length };
  }
  const passed = rows.filter((row) => row.pass).length;
  return {
    status: 'complete',
    expectedCases,
    observedCases: rows.length,
    passed,
    failed: rows.length - passed,
    score: rows.reduce((sum, row) => sum + (row.score ?? (row.pass ? 1 : 0)), 0),
    costUsd: rows.every((row) => row.cost !== null)
      ? Number(rows.reduce((sum, row) => sum + row.cost, 0).toFixed(8))
      : null,
  };
}

export function buildCommitSafeSummary({ policyHash, fixtureHash, promptHash, manifests }) {
  const providers = [...new Set(manifests.map((manifest) => manifest.providerId))].map((providerId) => {
    const providerRuns = manifests.filter((manifest) => manifest.providerId === providerId);
    const smoke = providerRuns.find((manifest) => manifest.phase === 'smoke');
    const full = providerRuns.filter((manifest) => manifest.phase === 'full').sort((left, right) => left.runId - right.runId);
    const smokePassed = smoke?.aggregate?.status === 'complete' && smoke.aggregate.passed === 3;
    const fullPassedTwice = full.length === 2 && full.every((run) => run.aggregate?.status === 'complete' && run.aggregate.passed === 33);
    const hashes = providerRuns.map((manifest) => ({ phase: manifest.phase, run: manifest.runId, sha256: manifest.rawSha256 }));
    const totalCostUsd = providerRuns.every((manifest) => typeof manifest.aggregate?.costUsd === 'number')
      ? Number(providerRuns.reduce((sum, manifest) => sum + manifest.aggregate.costUsd, 0).toFixed(8))
      : null;
    return {
      providerId,
      aggregate: {
        smoke: smoke?.aggregate ?? null,
        full: full.map((run) => run.aggregate),
        totalCostUsd,
      },
      hashes,
      decision: smokePassed && fullPassedTwice ? 'candidate' : smokePassed ? 'rejected_after_full' : 'rejected_at_smoke',
      productionMutationAllowed: false,
    };
  });
  return {
    schemaVersion: 1,
    status: manifests.length ? 'evaluated' : 'not_run',
    hashes: { policy: policyHash, fixture: fixtureHash, prompt: promptHash },
    providers,
    decision: {
      champion: 'deepseek-champion',
      championChanged: false,
      productionProviderMutationAllowed: false,
      databaseEnumMutationAllowed: false,
    },
  };
}
