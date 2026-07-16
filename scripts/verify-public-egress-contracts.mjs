#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const json = args.has('--json');

const checks = [
  {
    id: 'public-egress-boundary',
    command: process.execPath,
    args: ['node_modules/vitest/vitest.mjs', 'run', 'src/lib/public-packages/egress-boundary.test.ts'],
  },
];

function run(check) {
  const result = spawnSync(check.command, check.args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  return {
    id: check.id,
    status: result.status === 0 ? 'pass' : 'fail',
    command: [check.command, ...check.args].join(' '),
    exitCode: result.status,
    stdout: result.status === 0 ? '' : String(result.stdout || '').trim().slice(0, 2000),
    stderr: result.status === 0 ? '' : String(result.stderr || result.error?.message || '').trim().slice(0, 2000),
  };
}

const results = checks.map(run);
const failed = results.filter(check => check.status !== 'pass');
const report = {
  status: failed.length === 0 ? 'pass' : 'fail',
  passed: results.length - failed.length,
  failed: failed.length,
  checks: results,
};

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const check of results) console.log(`${check.status.toUpperCase()} ${check.id}`);
}

if (failed.length > 0) process.exit(1);
