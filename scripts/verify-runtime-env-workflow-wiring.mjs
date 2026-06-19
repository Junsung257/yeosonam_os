#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
const json = args.has('--json');

const readiness = JSON.parse(readFileSync('src/config/runtime-env-readiness.json', 'utf8'));
const workflowPaths = [
  '.github/workflows/open-readiness.yml',
  '.github/workflows/local-release-readiness.yml',
  '.github/workflows/marketing-release-readiness.yml',
  '.github/workflows/full-readiness.yml',
];
const dataProbeKeys = [
  'OPEN_CHECK_PACKAGE_ID',
  'OPEN_CHECK_REF_CODE',
  'MARKETING_CHECK_CARD_NEWS_ID',
  'MARKETING_CHECK_VARIANT_GROUP_ID',
];

const checks = [];

function addCheck(name, status, detail = {}) {
  checks.push({ name, status, ...detail });
}

function workflowText(path) {
  return readFileSync(path, 'utf8');
}

function hasEnvAssignment(text, key) {
  return new RegExp(`(^|\\n)\\s*${key}:\\s*\\$\\{\\{`, 'm').test(text);
}

function hasRuntimeSource(text, key) {
  return text.includes(`secrets.${key}`) || text.includes(`vars.${key}`);
}

function checkWorkflow(path) {
  const text = workflowText(path);
  const required = [
    ...dataProbeKeys.map((key) => ({ key, sourceRequired: false })),
    ...readiness.critical.map((key) => ({ key, sourceRequired: true })),
    ...readiness.warnDefaults.map((key) => ({ key, sourceRequired: false })),
  ];

  const missing = [];
  const missingSources = [];

  for (const { key, sourceRequired } of required) {
    if (!hasEnvAssignment(text, key)) {
      missing.push(key);
      continue;
    }
    if (sourceRequired && !hasRuntimeSource(text, key)) {
      missingSources.push(key);
    }
  }

  addCheck(`workflow:${path}:runtime-env-wiring`, missing.length || missingSources.length ? 'fail' : 'pass', {
    file: path,
    missing,
    missingSources,
  });
}

for (const path of workflowPaths) {
  checkWorkflow(path);
}

const failed = checks.filter((check) => check.status === 'fail').length;
const report = {
  status: failed > 0 ? 'fail' : 'pass',
  passed: checks.length - failed,
  failed,
  checks,
};

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const check of checks) {
    console.log(`${check.status.toUpperCase()} ${check.name}`);
    if (check.status === 'fail') {
      if (check.missing?.length) console.log(`  missing: ${check.missing.join(', ')}`);
      if (check.missingSources?.length) console.log(`  missing sources: ${check.missingSources.join(', ')}`);
    }
  }
}

process.exitCode = failed > 0 ? 1 : 0;
