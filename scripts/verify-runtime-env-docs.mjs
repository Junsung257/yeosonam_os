#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
const json = args.has('--json');

const contractPath = 'src/config/runtime-env-readiness.json';
const requiredDocs = [
  'docs/env-variables-reference.md',
  'docs/deploy-checklist.md',
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readText(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function checkDocument(path, keys) {
  const text = readText(path);
  const missing = keys.filter((key) => !text.includes(`\`${key}\``) && !text.includes(key));
  return {
    name: `runtime-env-doc:${path}`,
    status: missing.length === 0 ? 'pass' : 'fail',
    file: path,
    missing,
  };
}

const contract = readJson(contractPath);
const keys = unique([
  ...(Array.isArray(contract.critical) ? contract.critical : []),
  ...(Array.isArray(contract.optionalIntegrations) ? contract.optionalIntegrations : []),
  ...(Array.isArray(contract.warnDefaults) ? contract.warnDefaults : []),
]);

const checks = requiredDocs.map((path) => checkDocument(path, keys));
const failed = checks.filter((check) => check.status === 'fail');
const report = {
  status: failed.length === 0 ? 'pass' : 'fail',
  passed: checks.length - failed.length,
  failed: failed.length,
  contractPath,
  keys,
  checks,
};

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const check of checks) {
    const suffix = check.missing.length > 0 ? ` missing=${check.missing.join(', ')}` : '';
    console.log(`${check.status.toUpperCase()} ${check.name}${suffix}`);
  }
}

if (failed.length > 0) process.exit(1);
