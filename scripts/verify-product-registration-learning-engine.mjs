#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const knownArgs = new Set(['--live', '--build', '--command-timeout-ms']);

function argValue(name, fallback = '') {
  let value = fallback;
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === name && rawArgs[index + 1] !== undefined) value = rawArgs[index + 1];
    if (arg.startsWith(`${name}=`)) value = arg.slice(name.length + 1);
  }
  return value;
}

function argKey(arg) {
  return String(arg || '').split('=')[0];
}

const unknownArgs = rawArgs.filter((arg, index) => {
  if (index > 0 && rawArgs[index - 1] === '--command-timeout-ms') return false;
  return arg.startsWith('--') && !knownArgs.has(argKey(arg));
});

if (unknownArgs.length > 0) {
  for (const arg of unknownArgs) {
    console.error(`Unknown product registration learning verification argument: ${arg}`);
  }
  process.exit(1);
}

const commandTimeoutMs = Number(argValue(
  '--command-timeout-ms',
  process.env.PRODUCT_REGISTRATION_LEARNING_VERIFY_COMMAND_TIMEOUT_MS || '900000',
));

if (!Number.isFinite(commandTimeoutMs) || commandTimeoutMs <= 0) {
  console.error('--command-timeout-ms must be a positive number of milliseconds.');
  process.exit(1);
}

const includeLive = args.has('--live');
const includeBuild = args.has('--build');

const commands = [
  {
    label: 'learning engine focused tests',
    command: 'npx',
    args: [
      'vitest',
      'run',
      'src/lib/product-registration/learning-engine-integration.test.ts',
      'src/lib/product-registration/auto-qa.test.ts',
      'src/lib/product-registration/deliverability-gate.test.ts',
      'src/lib/product-registration/improvement-ledger-persistence.test.ts',
      'src/lib/product-registration/learning-engine-report.test.ts',
      'src/lib/product-registration/upload-review-regression-verifier.test.ts',
      'src/lib/product-registration/upload-route-boundary.test.ts',
      'src/app/admin/registration-monitor/page.test.ts',
      'src/components/AdminLayout.test.ts',
    ],
  },
  {
    label: 'product registration regression tests',
    command: 'npx',
    args: [
      'vitest',
      'run',
      'src/lib/parser/deterministic',
      'src/lib/product-registration',
      'src/lib/upload-validator.test.ts',
      'src/lib/price-dates.test.ts',
      'src/lib/upload-verify.test.ts',
    ],
  },
  { label: 'type check', command: 'npm', args: ['run', 'type-check'] },
  { label: 'golden corpus eval', command: 'npm', args: ['run', 'eval:product-registration:ci'] },
  { label: 'OCR/PDF candidate benchmark', command: 'npm', args: ['run', 'benchmark:product-ocr:ci'] },
  {
    label: 'mobile/A4 audit syntax',
    command: 'node',
    args: ['--check', 'scripts/audit-product-mobile-landing-readiness.mjs'],
  },
  {
    label: 'product registration SSOT/code contract',
    command: 'npm',
    args: ['run', 'check:product-registration-contract'],
  },
  {
    label: 'upload review fixture candidate export self-test',
    command: 'npx',
    args: ['tsx', 'scripts/export-upload-review-fixture-candidates.ts', '--self-test'],
  },
  {
    label: 'upload review fixture scaffold self-test',
    command: 'npx',
    args: [
      'tsx',
      'scripts/export-upload-review-fixture-candidates.ts',
      '--self-test',
      '--scaffold',
      '--scaffold-dir=.tmp/product-registration-fixture-scaffold-self-test',
      '--scaffold-limit=1',
    ],
  },
  {
    label: 'upload review live regression replay',
    command: 'npm',
    args: ['run', 'verify:upload-review-regressions', '--', '--days=30', '--limit=200', '--strict'],
  },
  { label: 'migration prefix audit', command: 'npm', args: ['run', 'audit:migration-prefix:ci'] },
];

if (includeLive) {
  commands.push({
    label: 'live stored sample learning verification',
    command: 'npm',
    args: [
      'run',
      'verify:product-registration-live-samples',
      '--',
      '--strict',
      '--limit=20',
      '--days=365',
    ],
  });
  commands.push({
    label: 'live public mobile/A4 readiness audit',
    command: 'npm',
    args: [
      'run',
      'audit:product-mobile-readiness',
      '--',
      '--strict',
      '--days=365',
      '--limit=30',
      '--json',
      '--public-only',
    ],
  });
}

if (includeBuild) {
  commands.push({ label: 'production build', command: 'npm', args: ['run', 'build'] });
}

function printable(command, commandArgs) {
  return [command, ...commandArgs].join(' ');
}

for (const step of commands) {
  console.log(`\n=== ${step.label} ===`);
  const commandLine = printable(step.command, step.args);
  console.log(`$ ${commandLine}`);
  const startedAt = Date.now();
  const result = spawnSync(commandLine, {
    cwd: process.cwd(),
    env: process.env,
    shell: true,
    stdio: 'inherit',
    timeout: commandTimeoutMs,
  });
  const timedOut = result.error?.code === 'ETIMEDOUT';
  if (result.status !== 0 || timedOut) {
    if (timedOut) {
      console.error(`\nVerification timed out at: ${step.label} after ${commandTimeoutMs}ms`);
    }
    if (result.error && !timedOut) {
      console.error(`\nVerification command error at: ${step.label}: ${result.error.message}`);
    }
    console.error(`Duration: ${Date.now() - startedAt}ms`);
    console.error(`\nVerification failed at: ${step.label}`);
    process.exit(result.status ?? (timedOut ? 124 : 1));
  }
}

console.log('\nProduct registration learning engine verification passed.');
