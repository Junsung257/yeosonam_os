#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const json = args.has('--json');

const MODES = new Set(['legacy', 'shadow', 'canary', 'enforced']);
const CANARY_POLICIES = new Set(['fallback_legacy', 'fail_closed']);

function modeFromEnv(env) {
  const requested = String(env.PUBLIC_PACKAGE_EGRESS_MODE || '').trim().toLowerCase();
  return MODES.has(requested) ? requested : 'legacy';
}

function numberValue(env, key) {
  const value = Number(env[key]);
  return Number.isFinite(value) ? value : 0;
}

function evaluate(env = process.env) {
  const mode = modeFromEnv(env);
  const blockers = [];
  const requestedMode = env.PUBLIC_PACKAGE_EGRESS_MODE || null;
  const canaryIds = String(env.PUBLIC_PACKAGE_EGRESS_CANARY_PACKAGE_IDS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  const canaryPolicy = String(env.PUBLIC_PACKAGE_EGRESS_CANARY_FAILURE_POLICY || '').trim().toLowerCase();

  if (mode === 'canary' && canaryIds.length === 0) {
    blockers.push('canary mode requires PUBLIC_PACKAGE_EGRESS_CANARY_PACKAGE_IDS');
  }

  if (canaryPolicy && !CANARY_POLICIES.has(canaryPolicy)) {
    blockers.push('PUBLIC_PACKAGE_EGRESS_CANARY_FAILURE_POLICY must be fallback_legacy or fail_closed');
  }

  if (mode === 'enforced') {
    if (env.PUBLIC_PACKAGE_EGRESS_ACTIVATION_READY !== 'true') {
      blockers.push('PUBLIC_PACKAGE_EGRESS_ACTIVATION_READY must be true');
    }
    if (!String(env.PUBLIC_PACKAGE_EGRESS_STAGING_GATE_ID || '').trim()) {
      blockers.push('PUBLIC_PACKAGE_EGRESS_STAGING_GATE_ID is required');
    }
    if (numberValue(env, 'PUBLIC_PACKAGE_EGRESS_SNAPSHOT_ROWS') <= 0) {
      blockers.push('snapshot rows must be greater than 0');
    }
    if (numberValue(env, 'PUBLIC_PACKAGE_EGRESS_GATE_PASS_SNAPSHOTS') <= 0) {
      blockers.push('gate-pass snapshots must be greater than 0');
    }
    if (numberValue(env, 'PUBLIC_PACKAGE_EGRESS_FRESH_PROOFS') <= 0) {
      blockers.push('fresh exact proofs must be greater than 0');
    }
    if (numberValue(env, 'PUBLIC_PACKAGE_EGRESS_PROJECTION_COVERAGE') < 100) {
      blockers.push('projection coverage must be 100');
    }
    if (numberValue(env, 'PUBLIC_PACKAGE_EGRESS_ACTIVE_POLLUTION') !== 0) {
      blockers.push('active unresolved pollution must be 0');
    }
    if (numberValue(env, 'PUBLIC_PACKAGE_EGRESS_EXTERNAL_RAW_FALLBACK') !== 0) {
      blockers.push('external raw fallback must be 0');
    }
    if (numberValue(env, 'PUBLIC_PACKAGE_EGRESS_BLOCKED_EXPOSURE') !== 0) {
      blockers.push('blocked external exposure must be 0');
    }
  }

  return {
    status: blockers.length === 0 ? 'pass' : 'block',
    mode,
    requestedMode,
    defaulted: mode === 'legacy' && requestedMode !== 'legacy',
    blockers,
  };
}

const test = spawnSync(process.execPath, [
  'node_modules/vitest/vitest.mjs',
  'run',
  'src/lib/public-packages/rollout-mode.test.ts',
], {
  cwd: process.cwd(),
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

const activation = evaluate();
const checks = [
  {
    id: 'rollout-mode-unit-contract',
    status: test.status === 0 ? 'pass' : 'fail',
    exitCode: test.status,
    stdout: test.status === 0 ? '' : String(test.stdout || '').trim().slice(0, 2000),
    stderr: test.status === 0 ? '' : String(test.stderr || test.error?.message || '').trim().slice(0, 2000),
  },
  {
    id: 'rollout-mode-activation-env',
    status: activation.status === 'pass' ? 'pass' : 'block',
    ...activation,
  },
];

const failed = checks.filter(check => check.status === 'fail');
const blocked = checks.filter(check => check.status === 'block');
const report = {
  status: failed.length > 0 ? 'fail' : blocked.length > 0 ? 'block' : 'pass',
  passed: checks.filter(check => check.status === 'pass').length,
  blocked: blocked.length,
  failed: failed.length,
  checks,
};

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const check of checks) {
    const suffix = check.blockers?.length ? ` - ${check.blockers.join('; ')}` : '';
    console.log(`${check.status.toUpperCase()} ${check.id}${suffix}`);
  }
}

if (failed.length > 0 || blocked.length > 0) process.exit(1);
