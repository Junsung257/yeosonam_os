#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
const json = args.has('--json');
const workflowPath = '.github/workflows/pr749-staging-data-gate.yml';

function includesAll(text, needles) {
  return needles.every((needle) => text.includes(needle));
}

function main() {
  let text = '';
  try {
    text = readFileSync(workflowPath, 'utf8');
  } catch (error) {
    const report = {
      status: 'fail',
      passed: 0,
      failed: 1,
      checks: [{
        id: 'workflow-file-present',
        status: 'fail',
        message: error instanceof Error ? error.message : String(error),
      }],
    };
    if (json) console.log(JSON.stringify(report, null, 2));
    else console.log('FAIL workflow-file-present');
    process.exit(1);
    return;
  }

  const checks = [
    {
      id: 'workflow-name',
      status: text.includes('name: PR 749 Staging Data Gate') ? 'pass' : 'fail',
    },
    {
      id: 'workflow-dispatch-inputs',
      status: includesAll(text, [
        'workflow_dispatch:',
        'expected_head_sha:',
        'action:',
        'allow_mutation:',
        'use_existing_staging_data:',
        'run_full_500_audit:',
        'retain_fixtures:',
        'expected_project_ref:',
      ]) ? 'pass' : 'fail',
    },
    {
      id: 'protected-staging-environment',
      status: /environment:\s*\n\s*name:\s*staging/.test(text) ? 'pass' : 'fail',
    },
    {
      id: 'minimal-permissions',
      status: /permissions:\s*\n\s*contents:\s*read\s*\n\s*actions:\s*read/.test(text) ? 'pass' : 'fail',
    },
    {
      id: 'identity-gate-script',
      status: text.includes('verify:staging-identity') && text.includes('REQUIRE_PROTECTED_STAGING_ENVIRONMENT: "true"') ? 'pass' : 'fail',
    },
    {
      id: 'protected-environment-ack',
      status: text.includes('REQUIRE_STAGING_PROTECTION_ACK: "true"') &&
        text.includes('STAGING_ENVIRONMENT_PROTECTION_ACK: ${{ vars.STAGING_ENVIRONMENT_PROTECTION_ACK }}')
        ? 'pass'
        : 'fail',
    },
    {
      id: 'evidence-validator',
      status: text.includes('verify:pr749-staging-evidence') && text.includes('--require-pass') ? 'pass' : 'fail',
    },
    {
      id: 'artifact-upload',
      status: text.includes('actions/upload-artifact@v4') && text.includes('pr749-staging-gate-evidence') ? 'pass' : 'fail',
    },
    {
      id: 'no-production-secret-reference',
      status: /secrets\.PRODUCTION_|PRODUCTION_SUPABASE_SERVICE_ROLE_KEY|PRODUCTION_DATABASE_URL/.test(text) ? 'fail' : 'pass',
    },
  ];

  const failed = checks.filter((check) => check.status !== 'pass');
  const report = {
    status: failed.length === 0 ? 'pass' : 'fail',
    passed: checks.length - failed.length,
    failed: failed.length,
    workflowPath,
    checks,
  };

  if (json) console.log(JSON.stringify(report, null, 2));
  else checks.forEach((check) => console.log(`${check.status.toUpperCase()} ${check.id}`));
  if (failed.length > 0) process.exit(1);
}

main();
