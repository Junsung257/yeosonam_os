#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const json = args.has('--json');
const outDir = resolve('.tmp', 'operational-apply-scripts-verify');

const operationalKeys = [
  'OPEN_CHECK_PACKAGE_ID',
  'OPEN_CHECK_REF_CODE',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_PROJECT_REF',
  'VERCEL_TOKEN',
  'SERPAPI_KEY',
  'BAND_RSS_URL',
  'TWITTER_BEARER_TOKEN',
  'NAVER_CLIENT_ID',
  'NAVER_CLIENT_SECRET',
  'NAVER_CAFE_ID',
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_CUSTOMER_ID',
  'GOOGLE_ADS_CLIENT_ID',
  'GOOGLE_ADS_CLIENT_SECRET',
  'SLACK_WEBHOOK_URL',
  'CRON_SECRET',
  'BLOG_QUALITY_SOURCE_READY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'AD_FLAG_UP_BID_FACTOR',
  'AD_OFFPEAK_BID_FACTOR',
  'AD_MIN_BID_KRW',
];

function run(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    ...options,
  });
}

function parseJson(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.lastIndexOf('\n{');
    return start >= 0 ? JSON.parse(text.slice(start + 1)) : null;
  }
}

function clearOperationalEnv() {
  const env = { ...process.env, FORCE_COLOR: '0' };
  for (const key of operationalKeys) delete env[key];
  return env;
}

function filledDryRunEnv() {
  const env = clearOperationalEnv();
  env.OPERATIONAL_APPLY_DRY_RUN = '1';
  env.VERCEL_ENV_TARGETS = 'production preview';
  return env;
}

function writeFilledEnvFile(path) {
  const lines = [
    '# Filled operational inputs for dry-run verification.',
    ...operationalKeys.map((key) => `${key}=${key.toLowerCase()}-env-file-dry-run-value`),
    '',
  ];
  writeFileSync(path, lines.join('\n'));
}

function writeNoisyEnvFile(path) {
  const lines = [
    '# Filled operational inputs with intentional quality warnings.',
    ...operationalKeys.map((key) => `${key}=${key.toLowerCase()}-env-file-dry-run-value`),
    'SERPAPI_KEY=duplicate-dry-run-value',
    'SERPAPI_KEY_TYPO=typo-dry-run-value',
    'EMPTY_UNKNOWN_KEY=',
    'NOT A VALID ENV LINE',
    '',
  ];
  writeFileSync(path, lines.join('\n'));
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function outputOf(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function assertIncludes(text, needle, label) {
  check(text.includes(needle), `${label} missing "${needle}"`);
}

function assertExcludes(text, needle, label) {
  check(!text.includes(needle), `${label} leaked "${needle}"`);
}

function assertBashEnvFileContract(paths) {
  const apply = readFileSync(paths.bashApply, 'utf8');
  const vercel = readFileSync(paths.bashVercel, 'utf8');
  for (const [label, text] of [
    ['bash apply', apply],
    ['bash Vercel', vercel],
  ]) {
    assertIncludes(text, '--env-file', label);
    assertIncludes(text, 'OPERATIONAL_INPUTS_ENV_FILE', label);
    assertIncludes(text, 'load_env_file "$env_file"', label);
    assertIncludes(text, 'OPERATIONAL_APPLY_DRY_RUN', label);
  }
  assertIncludes(apply, 'DRY-RUN gh secret set SERPAPI_KEY --body <redacted>', 'bash apply');
  assertIncludes(apply, 'DRY-RUN gh variable set OPEN_CHECK_PACKAGE_ID --body <redacted>', 'bash apply');
  assertIncludes(vercel, 'DRY-RUN vercel env add $key $target --value <redacted>', 'bash Vercel');
}

function main() {
  mkdirSync(outDir, { recursive: true });
  const paths = {
    template: resolve(outDir, 'inputs.env.example'),
    plan: resolve(outDir, 'action-plan.md'),
    bashApply: resolve(outDir, 'apply.sh'),
    bashVercel: resolve(outDir, 'vercel-env.sh'),
    nodeApply: resolve(outDir, 'apply.mjs'),
    nodeVercel: resolve(outDir, 'vercel-env.mjs'),
    envFile: resolve(outDir, 'filled-inputs.env'),
    noisyEnvFile: resolve(outDir, 'filled-inputs-noisy.env'),
  };

  const generate = run(process.execPath, [
    'scripts/verify-operational-readiness-inputs.mjs',
    '--json',
    `--template-out=${paths.template}`,
    `--plan-out=${paths.plan}`,
    `--apply-script-out=${paths.bashApply}`,
    `--vercel-script-out=${paths.bashVercel}`,
    `--node-apply-script-out=${paths.nodeApply}`,
    `--node-vercel-script-out=${paths.nodeVercel}`,
  ], { env: clearOperationalEnv() });
  check(generate.status === 0, `generator failed: ${outputOf(generate)}`);

  const report = parseJson(generate.stdout);
  check(report?.status === 'blocked', 'generator should report blocked with operational env cleared');
  check(report.nodeApplyScriptPath === paths.nodeApply, 'node apply script path missing from report');
  check(report.nodeVercelScriptPath === paths.nodeVercel, 'node Vercel script path missing from report');

  for (const path of [paths.nodeApply, paths.nodeVercel]) {
    const syntax = run(process.execPath, ['--check', path]);
    check(syntax.status === 0, `syntax check failed for ${path}: ${outputOf(syntax)}`);
  }

  const env = filledDryRunEnv();
  writeFilledEnvFile(paths.envFile);
  writeNoisyEnvFile(paths.noisyEnvFile);
  assertBashEnvFileContract(paths);

  const envFileAudit = run(process.execPath, [
    'scripts/verify-operational-readiness-inputs.mjs',
    '--json',
    `--env-file=${paths.envFile}`,
  ], { env: clearOperationalEnv() });
  const envFileAuditReport = parseJson(envFileAudit.stdout);
  check(
    envFileAudit.status === 0 && envFileAuditReport?.status === 'pass',
    `operational input env-file audit failed: ${outputOf(envFileAudit)}`,
  );

  const noisyEnvFileAudit = run(process.execPath, [
    'scripts/verify-operational-readiness-inputs.mjs',
    '--json',
    `--env-file=${paths.noisyEnvFile}`,
  ], { env: clearOperationalEnv() });
  const noisyReport = parseJson(noisyEnvFileAudit.stdout);
  check(
    noisyEnvFileAudit.status === 0 && noisyReport?.status === 'warn',
    `noisy operational input env-file should warn: ${outputOf(noisyEnvFileAudit)}`,
  );
  check(
    noisyReport?.envFileDiagnostics?.unknownKeys?.includes('SERPAPI_KEY_TYPO'),
    'noisy env-file audit did not report unknown key',
  );
  check(
    noisyReport?.envFileDiagnostics?.duplicateKeys?.includes('SERPAPI_KEY'),
    'noisy env-file audit did not report duplicate key',
  );
  check(
    noisyReport?.envFileDiagnostics?.invalidLines?.length > 0,
    'noisy env-file audit did not report invalid line',
  );

  const apply = run(process.execPath, [paths.nodeApply, `--env-file=${paths.envFile}`], { env });
  const applyOutput = outputOf(apply);
  check(apply.status === 0, `node apply dry-run failed: ${applyOutput}`);
  assertIncludes(applyOutput, 'DRY-RUN gh secret set SERPAPI_KEY --body <redacted>', 'node apply dry-run');
  assertIncludes(applyOutput, 'DRY-RUN gh variable set OPEN_CHECK_PACKAGE_ID --body <redacted>', 'node apply dry-run');
  assertIncludes(applyOutput, 'Operational readiness inputs applied to GitHub Actions configuration.', 'node apply dry-run');
  assertExcludes(applyOutput, 'serpapi_key-env-file-dry-run-value', 'node apply dry-run');

  const vercel = run(process.execPath, [paths.nodeVercel, `--env-file=${paths.envFile}`], { env });
  const vercelOutput = outputOf(vercel);
  check(vercel.status === 0, `node Vercel dry-run failed: ${vercelOutput}`);
  assertIncludes(vercelOutput, 'DRY-RUN vercel env add SERPAPI_KEY production --value <redacted>', 'node Vercel dry-run');
  assertIncludes(vercelOutput, 'DRY-RUN vercel env add SERPAPI_KEY preview --value <redacted>', 'node Vercel dry-run');
  assertIncludes(vercelOutput, 'Runtime environment values applied to Vercel.', 'node Vercel dry-run');
  assertExcludes(vercelOutput, 'serpapi_key-env-file-dry-run-value', 'node Vercel dry-run');

  return {
    status: 'pass',
    passed: 7,
    failed: 0,
    checks: [
      { id: 'generate-apply-scripts', status: 'pass' },
      { id: 'operational-inputs-env-file-pass', status: 'pass' },
      { id: 'operational-inputs-env-file-quality-warn', status: 'pass' },
      { id: 'bash-apply-env-file-contract', status: 'pass' },
      { id: 'node-apply-syntax', status: 'pass' },
      { id: 'node-apply-dry-run', status: 'pass' },
      { id: 'node-vercel-dry-run', status: 'pass' },
    ],
    paths,
  };
}

let report;
try {
  report = main();
} catch (err) {
  report = {
    status: 'fail',
    passed: 0,
    failed: 1,
    checks: [{
      id: 'operational-apply-scripts',
      status: 'fail',
      error: err instanceof Error ? err.message : String(err),
    }],
  };
}

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const check of report.checks) {
    const suffix = check.error ? ` - ${check.error}` : '';
    console.log(`${check.status.toUpperCase()} ${check.id}${suffix}`);
  }
}

if (report.status !== 'pass') process.exit(1);
