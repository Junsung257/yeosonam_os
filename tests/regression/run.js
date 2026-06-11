#!/usr/bin/env node
/**
 * Run every executable regression fixture in tests/regression/cases with
 * Node's built-in test runner.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CASES_DIR = path.join(__dirname, 'cases');

function listCases(filter) {
  if (!fs.existsSync(CASES_DIR)) return [];
  return fs.readdirSync(CASES_DIR)
    .filter((file) => file.endsWith('.test.js'))
    .filter((file) => !filter || file.includes(filter))
    .map((file) => path.join(CASES_DIR, file));
}

function main() {
  const filterIndex = process.argv.indexOf('--filter');
  const filter = filterIndex >= 0 ? process.argv[filterIndex + 1] : null;
  const cases = listCases(filter);

  console.log();
  console.log('='.repeat(72));
  console.log('Error Registry Regression Tests');
  console.log('='.repeat(72));
  console.log(`Cases: ${cases.length}${filter ? ` (filter: ${filter})` : ''}`);
  console.log();

  if (cases.length === 0) {
    console.log('No cases found. Add tests/regression/cases/<ERR-CODE>.test.js.');
    return;
  }

  const result = spawnSync('node', ['--test', '--test-reporter=spec', ...cases], {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..', '..'),
  });
  process.exit(result.status ?? 0);
}

main();
