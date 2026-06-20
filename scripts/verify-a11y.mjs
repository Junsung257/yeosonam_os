#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has('--json');
const eslintBin = './node_modules/eslint/bin/eslint.js';
const eslintArgs = [
  eslintBin,
  'src/**/*.{ts,tsx}',
  '--no-eslintrc',
  '--config',
  'eslint-a11y.config.js',
  '--format=compact',
];

const result = spawnSync(process.execPath, eslintArgs, {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
  windowsHide: true,
});

const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
const failed = result.status === 0 ? 0 : 1;
const report = {
  status: failed > 0 ? 'fail' : 'pass',
  passed: failed > 0 ? 0 : 1,
  blocked: 0,
  failed,
  total: 1,
  checks: [
    {
      id: 'lint-a11y',
      name: 'eslint a11y rules',
      status: failed > 0 ? 'fail' : 'pass',
      notes: output.slice(0, 1200),
    },
  ],
};

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else if (output) {
  console.log(output);
} else {
  console.log('PASS lint:a11y');
}

process.exit(failed > 0 ? 1 : 0);
