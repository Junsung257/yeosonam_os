#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const json = args.has('--json');
const strict = args.has('--strict');

function argValue(name, fallback = '') {
  const prefix = `${name}=`;
  const inline = rawArgs.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = rawArgs.indexOf(name);
  return index >= 0 ? rawArgs[index + 1] ?? fallback : fallback;
}

function parseJson(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.lastIndexOf('\n{');
    return start >= 0 ? JSON.parse(text.slice(start + 1)) : null;
  }
}

function runNode(id, script, extraArgs = [], options = {}) {
  const result = spawnSync(process.execPath, [script, ...extraArgs], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const report = parseJson(result.stdout);
  return {
    id,
    exitCode: result.status,
    status: options.acceptExitCodes?.includes(result.status) && report
      ? report.status ?? 'unknown'
      : result.status === 0
        ? report?.status ?? 'pass'
        : 'fail',
    report,
    stderr: String(result.stderr || result.error?.message || '').trim().slice(0, 1600),
  };
}

function pass(check) {
  return check.exitCode === 0 && ['pass', 'blocked', 'warn'].includes(check.status);
}

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

const envFile = argValue('--env-file', '');
const outPath = argValue('--out', '');
const expectedHead = argValue('--expected-head', process.env.EXPECTED_HEAD_SHA || '');
const currentHead = runGit(['rev-parse', 'HEAD']);
const currentBranch = runGit(['branch', '--show-current']);
const workingTreeStatus = runGit(['status', '--short']);
const baseSha = runGit(['merge-base', 'HEAD', 'origin/main']) || null;
const checks = [];

const stagingIdentityArgs = ['--json'];
if (envFile) stagingIdentityArgs.push('--env-file', envFile);

checks.push(runNode(
  'staging-identity',
  'scripts/verify-staging-identity-gate.mjs',
  stagingIdentityArgs,
  { acceptExitCodes: [0, 1] },
));
checks.push(runNode('public-egress', 'scripts/verify-public-egress-contracts.mjs', ['--json']));
checks.push(runNode('public-package-security', 'scripts/verify-public-package-security-contracts.mjs', ['--json']));
checks.push(runNode('public-package-rollout-mode', 'scripts/verify-public-package-rollout-mode.mjs', ['--json']));

const stagingIdentity = checks.find(check => check.id === 'staging-identity')?.report;
const identityVerified = stagingIdentity?.status === 'pass' && stagingIdentity?.writeAllowed === true;
const staticGateFailures = checks.filter(check => check.id !== 'staging-identity' && !pass(check));
const preflightBlockers = [];
if (expectedHead && currentHead && expectedHead !== currentHead) {
  preflightBlockers.push('expected HEAD does not match current HEAD');
}

const skippedReason = identityVerified
  ? null
  : 'staging identity is not verified; no staging migration, seed, backfill, proof write, promotion, route smoke, admin smoke, or 500-package audit was executed';

const report = {
  status: identityVerified && staticGateFailures.length === 0 && preflightBlockers.length === 0 ? 'pass' : 'blocked',
  executiveVerdict: identityVerified
    ? staticGateFailures.length === 0 && preflightBlockers.length === 0
      ? 'STAGING IDENTITY VERIFIED - DATA GATES NOT EXECUTED BY THIS NO-WRITE REPORTER'
      : 'STAGING IDENTITY VERIFIED - STATIC GATES FAILED'
    : 'STAGING IDENTITY NOT VERIFIED',
  generatedAt: new Date().toISOString(),
  mode: 'no-write',
  envFile: envFile || null,
  productionMutationPerformed: false,
  stagingMutationPerformed: false,
  readyForReviewRecommended: false,
  preflight: {
    repositoryRoot: process.cwd(),
    currentBranch,
    currentHead,
    expectedHead: expectedHead || null,
    expectedHeadMatches: expectedHead ? expectedHead === currentHead : null,
    baseSha,
    workingTreeClean: workingTreeStatus.length === 0,
    productionMutationPerformed: false,
    stagingMutationPerformed: false,
    blockers: preflightBlockers,
  },
  github: {
    pr: 749,
    branch: 'codex/public-egress-boundary-v1',
    note: 'Use gh pr checks 749 for live GitHub/Vercel status; this report intentionally avoids changing PR state.',
  },
  stagingIdentity: stagingIdentity
    ? {
        verdict: stagingIdentity.verdict,
        writeAllowed: stagingIdentity.writeAllowed,
        identity: stagingIdentity.identity,
        productionDenyEvidence: stagingIdentity.productionDenyEvidence,
        blockedChecks: stagingIdentity.blockedChecks,
      }
    : null,
  staticGates: checks
    .filter(check => check.id !== 'staging-identity')
    .map(check => ({
      id: check.id,
      status: check.status,
      exitCode: check.exitCode,
      passed: check.report?.passed ?? null,
      failed: check.report?.failed ?? null,
      blocked: check.report?.blocked ?? null,
    })),
  stagingMetrics: {
    packages: null,
    snapshots: null,
    gatePassSnapshots: null,
    publishedPointers: null,
    projectionCoverage: null,
    proofs: {
      fresh: null,
      stale: null,
      missing: null,
      failed: null,
    },
    activePollution: null,
    historicalQuarantine: null,
    rawFallback: null,
    blockedExposure: null,
    selectionOnlyExceptions: null,
    skippedReason,
  },
  positivePathEvidence: {
    samples: [],
    skippedReason,
  },
  negativePathEvidence: {
    fixtures: [],
    skippedReason,
  },
  adminSmoke: {
    samples: [],
    screenshots: [],
    skippedReason,
  },
  regressionAudit: {
    command: 'npm run audit:public-snapshot-generation -- --json --limit=500 --samples=80',
    generated: null,
    repairable: null,
    blocked: null,
    falseGenerated: null,
    wrongPriceExposure: null,
    blockedExternalExposure: null,
    skippedReason,
  },
  requiredActionsBeforeReadyForReview: [
    'provide verified non-production staging identity values',
    'run staging pre-inventory and migration apply after identity passes',
    'generate source-backed public snapshots and exact fresh proofs in staging',
    'verify atomic promotion, projection coverage, positive routes, negative blockers, and admin public-review smoke',
    'run the 500-package public snapshot regression audit against staging or an approved non-production environment',
  ],
  checks: checks.map(check => ({
    id: check.id,
    status: check.status,
    exitCode: check.exitCode,
    stderr: check.stderr,
  })),
};

if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`verdict=${report.executiveVerdict}`);
  console.log(`status=${report.status}`);
  console.log(`stagingMutationPerformed=${report.stagingMutationPerformed}`);
  console.log(`productionMutationPerformed=${report.productionMutationPerformed}`);
  if (skippedReason) console.log(`skippedReason=${skippedReason}`);
}

if (strict && report.status !== 'pass') process.exit(1);
