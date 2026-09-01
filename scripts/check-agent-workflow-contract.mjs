#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const strict = process.argv.includes('--strict');

try {
  execFileSync(process.execPath, ['scripts/audit-doc-harness.mjs', ...(strict ? ['--strict'] : [])], {
    cwd: root,
    stdio: 'inherit',
  });
  console.log('Agent workflow contract check passed.');
} catch (error) {
  process.exit(typeof error?.status === 'number' ? error.status : 1);
}
