#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const args = new Set(process.argv.slice(2));
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
  const result = spawnSync(commandLine, {
    cwd: process.cwd(),
    env: process.env,
    shell: true,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error(`\nVerification failed at: ${step.label}`);
    process.exit(result.status ?? 1);
  }
}

console.log('\nProduct registration learning engine verification passed.');
