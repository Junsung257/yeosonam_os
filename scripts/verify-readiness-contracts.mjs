#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const json = args.has('--json');

const checksToRun = [
  {
    id: 'runtime-env-workflow-wiring',
    command: process.execPath,
    args: ['scripts/verify-runtime-env-workflow-wiring.mjs', '--json'],
  },
  {
    id: 'runtime-env-docs',
    command: process.execPath,
    args: ['scripts/verify-runtime-env-docs.mjs', '--json'],
  },
  {
    id: 'runtime-env-code',
    command: process.execPath,
    args: ['scripts/verify-runtime-env-code-wiring.mjs', '--json'],
  },
  {
    id: 'readiness-report-renderer',
    command: process.execPath,
    args: ['scripts/verify-readiness-report-renderer.mjs', '--json'],
  },
  {
    id: 'project-automation-wiring',
    command: process.execPath,
    args: ['scripts/verify-project-automation-wiring.mjs', '--json'],
  },
  {
    id: 'operational-inputs-self-test',
    command: process.execPath,
    args: [
      'scripts/verify-operational-readiness-inputs.mjs',
      '--self-test',
      '--json',
      '--template-out=.tmp/operational-readiness-inputs-contract.env.example',
      '--plan-out=.tmp/operational-readiness-inputs-contract-action-plan.md',
      '--apply-script-out=.tmp/operational-readiness-inputs-contract-apply.sh',
      '--vercel-script-out=.tmp/operational-readiness-inputs-contract-vercel-env.sh',
    ],
  },
];

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

function runCheck(check) {
  const result = spawnSync(check.command, check.args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const report = parseJson(result.stdout);
  const passed = result.status === 0 && report?.status === 'pass';
  return {
    id: check.id,
    status: passed ? 'pass' : 'fail',
    command: [check.command, ...check.args].join(' '),
    exitCode: result.status,
    passed: Number(report?.passed ?? 0),
    failed: Number(report?.failed ?? (passed ? 0 : 1)),
    reportStatus: report?.status || 'unknown',
    error: passed ? '' : (result.stderr || result.stdout || result.error?.message || '').trim().slice(0, 1200),
  };
}

const checks = checksToRun.map(runCheck);
const failed = checks.filter((check) => check.status === 'fail');
const report = {
  status: failed.length === 0 ? 'pass' : 'fail',
  passed: checks.filter((check) => check.status === 'pass').length,
  failed: failed.length,
  checks,
};

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const check of checks) {
    const suffix = check.error ? ` - ${check.error}` : '';
    console.log(`${check.status.toUpperCase()} ${check.id}${suffix}`);
  }
}

if (failed.length > 0) process.exit(1);
