#!/usr/bin/env tsx

import { spawnSync } from 'node:child_process';
import process from 'node:process';

type Step = {
  name: string;
  command: string;
  args: string[];
  optional?: boolean;
};

type StepResult = Step & {
  status: 'pass' | 'fail' | 'skipped';
  exitCode: number | null;
};

function readArg(name: string, fallback: string): string {
  return process.argv.find((arg) => arg.startsWith(`${name}=`))?.split('=').slice(1).join('=') ?? fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function runStep(step: Step): StepResult {
  console.log(`\n[gate] ${step.name}`);
  const commandLine = [step.command, ...step.args].map(shellQuote).join(' ');
  const result = spawnSync(commandLine, {
    stdio: 'inherit',
    shell: true,
    env: process.env,
    cwd: process.cwd(),
  });
  const exitCode = result.status ?? 1;
  return {
    ...step,
    status: exitCode === 0 ? 'pass' : 'fail',
    exitCode,
  };
}

function main() {
  const baseUrl = readArg('--base', process.env.PRODUCTION_URL || 'https://www.yeosonam.com');
  const publicLimit = readArg('--public-limit', '500');
  const dbLimit = readArg('--db-limit', '5000');
  const includeTypeCheck = !hasFlag('--skip-type-check');
  const includeBaseline = !hasFlag('--skip-baseline');
  const includeRehearsal = hasFlag('--include-rehearsal');

  const steps: Step[] = [
    ...(includeTypeCheck ? [{
      name: 'type-check',
      command: 'npm',
      args: ['run', 'type-check'],
    }] : []),
    ...(includeBaseline ? [{
      name: 'baseline-refresh dry-run preflight',
      command: 'node',
      args: ['scripts/refresh-baselines.js', '--dry-run'],
    }] : []),
    {
      name: 'production mobile text audit packages+lp',
      command: 'npx',
      args: [
        'tsx',
        'scripts/audit-mobile-landing-copy.ts',
        `--base=${baseUrl}`,
        '--scope=public',
        '--surfaces=packages,lp',
        '--concurrency=4',
        `--limit=${publicLimit}`,
        '--page-timeout-ms=15000',
        '--text-timeout-ms=5000',
        '--json',
      ],
    },
    {
      name: 'openable DB customer-visible audit',
      command: 'npx',
      args: [
        'tsx',
        'scripts/audit-customer-visible-product-text.ts',
        '--scope=openable',
        `--limit=${dbLimit}`,
        '--json',
      ],
    },
    {
      name: 'non-archived DB blocker audit',
      command: 'npx',
      args: [
        'tsx',
        'scripts/audit-customer-visible-product-text.ts',
        '--scope=non-archived',
        `--limit=${dbLimit}`,
        '--json',
      ],
    },
    ...(includeRehearsal ? [{
      name: 'latest pending customer-open rehearsal',
      command: 'npx',
      args: [
        'tsx',
        'scripts/rehearse-customer-open-candidate.ts',
        '--latest-pending',
        `--base=${baseUrl}`,
        '--json',
      ],
      optional: true,
    }] : []),
  ];

  const results = steps.map(runStep);
  const failedRequired = results.filter((result) => result.status === 'fail' && !result.optional);
  const summary = {
    checkedAt: new Date().toISOString(),
    baseUrl,
    ok: failedRequired.length === 0,
    results: results.map((result) => ({
      name: result.name,
      status: result.status,
      exitCode: result.exitCode,
      optional: Boolean(result.optional),
    })),
  };

  console.log('\n[gate] summary');
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(1);
}

main();
