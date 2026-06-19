#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
const json = args.has('--json');

function argValue(name, fallback = '') {
  const rawArgs = process.argv.slice(2);
  const prefix = `${name}=`;
  const inline = rawArgs.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = rawArgs.indexOf(name);
  return index >= 0 ? rawArgs[index + 1] ?? fallback : fallback;
}

const checkTimeoutMs = Number(argValue(
  '--check-timeout-ms',
  process.env.READINESS_CONTRACT_CHECK_TIMEOUT_MS || '300000',
));
const checkTimeoutKillGraceMs = Number(argValue(
  '--check-timeout-kill-grace-ms',
  process.env.READINESS_CONTRACT_CHECK_TIMEOUT_KILL_GRACE_MS || '5000',
));

const operationalEnvKeys = [
  'OPEN_CHECK_PACKAGE_ID',
  'OPEN_CHECK_REF_CODE',
  'MARKETING_CHECK_CARD_NEWS_ID',
  'MARKETING_CHECK_VARIANT_GROUP_ID',
  'CRON_SECRET',
  'OPEN_CHECK_AUTH_COOKIE',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_PROJECT_REF',
  'VERCEL_TOKEN',
  'SERPAPI_KEY',
  'NAVER_CLIENT_ID',
  'NAVER_CLIENT_SECRET',
  'META_AD_ACCOUNT_ID',
  'META_ACCESS_TOKEN',
  'META_ADS_ACCESS_TOKEN',
  'META_APP_ID',
  'META_APP_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
  'BAND_RSS_URL',
  'TWITTER_BEARER_TOKEN',
  'X_BEARER_TOKEN',
  'NAVER_CAFE_ID',
  'NAVER_ADS_API_KEY',
  'NAVER_ADS_SECRET_KEY',
  'NAVER_ADS_CUSTOMER_ID',
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_CUSTOMER_ID',
  'GOOGLE_ADS_CLIENT_ID',
  'GOOGLE_ADS_CLIENT_SECRET',
  'GOOGLE_ADS_REFRESH_TOKEN',
  'GOOGLE_ADS_CONVERSION_ACTION_ID',
  'THREADS_ACCESS_TOKEN',
  'THREADS_USER_ID',
  'SLACK_WEBHOOK_URL',
  'SLACK_PAYMENTS_WEBHOOK_URL',
  'SLACK_ALERT_WEBHOOK_URL',
  'SLACK_ALERTS_WEBHOOK',
  'SLACK_ALERTS_WEBHOOK_URL',
  'SLACK_CWV_WEBHOOK_URL',
  'AD_FLAG_UP_BID_FACTOR',
  'AD_OFFPEAK_BID_FACTOR',
  'AD_MIN_BID_KRW',
  'BLOG_QUALITY_SOURCE_READY',
  'OPERATIONAL_INPUTS_ENV_FILE',
];

const checksToRun = [
  {
    id: 'runtime-env-workflow-wiring',
    command: process.execPath,
    args: ['scripts/verify-runtime-env-workflow-wiring.mjs', '--json'],
  },
  {
    id: 'runtime-env-docs',
    command: process.execPath,
    args: ['scripts/verify-runtime-env-docs.mjs', '--json'],
  },
  {
    id: 'runtime-env-code',
    command: process.execPath,
    args: ['scripts/verify-runtime-env-code-wiring.mjs', '--json'],
  },
  {
    id: 'readiness-report-renderer',
    command: process.execPath,
    args: ['scripts/verify-readiness-report-renderer.mjs', '--json'],
  },
  {
    id: 'project-automation-wiring',
    command: process.execPath,
    args: ['scripts/verify-project-automation-wiring.mjs', '--json'],
  },
  {
    id: 'operational-inputs-self-test',
    command: process.execPath,
    args: [
      'scripts/verify-operational-readiness-inputs.mjs',
      '--self-test',
      '--json',
      '--template-out=.tmp/operational-readiness-inputs-contract.env.example',
      '--plan-out=.tmp/operational-readiness-inputs-contract-action-plan.md',
      '--apply-script-out=.tmp/operational-readiness-inputs-contract-apply.sh',
      '--vercel-script-out=.tmp/operational-readiness-inputs-contract-vercel-env.sh',
      '--node-apply-script-out=.tmp/operational-readiness-inputs-contract-apply.mjs',
      '--node-vercel-script-out=.tmp/operational-readiness-inputs-contract-vercel-env.mjs',
    ],
  },
  {
    id: 'operational-apply-scripts-dry-run',
    command: process.execPath,
    args: ['scripts/verify-operational-apply-scripts.mjs', '--json'],
  },
  {
    id: 'app-route-runtime-self-test',
    command: process.execPath,
    args: ['scripts/verify-app-route-runtime-smoke.mjs', '--self-test', '--json'],
  },
  {
    id: 'all-readiness-self-test',
    command: process.execPath,
    args: [
      'scripts/verify-all-readiness.mjs',
      '--self-test',
      '--json',
      '--strict',
      '--skip-build',
      '--skip-open-readiness',
      '--skip-app-route-runtime',
      '--skip-runtime',
    ],
  },
  {
    id: 'marketing-release-smoke',
    command: process.execPath,
    args: [
      'scripts/verify-marketing-release-readiness.mjs',
      '--skip-type-check',
      '--skip-lint',
      '--skip-marketing-automation',
      '--skip-readiness-contracts',
      '--skip-runtime',
      '--skip-build',
      '--json',
      '--report=.tmp/marketing-release-contract-report.json',
    ],
    expectedStatus: 'blocked',
    clearOperationalEnv: true,
  },
  {
    id: 'marketing-release-strict-blocked-exit',
    command: process.execPath,
    args: [
      'scripts/verify-marketing-release-readiness.mjs',
      '--strict',
      '--skip-type-check',
      '--skip-lint',
      '--skip-marketing-automation',
      '--skip-readiness-contracts',
      '--skip-runtime',
      '--skip-build',
      '--skip-operational-discovery',
      '--json',
      '--report=.tmp/marketing-release-strict-blocked-contract-report.json',
    ],
    expectedStatus: 'warn',
    allowedStatuses: ['warn', 'blocked'],
    allowedExitCodes: [0, 2],
    clearOperationalEnv: true,
  },
  {
    id: 'local-release-strict-blocked-exit',
    command: process.execPath,
    args: [
      'scripts/verify-local-release-readiness.mjs',
      '--strict',
      '--skip-type-check',
      '--skip-lint',
      '--skip-a11y',
      '--skip-sensitive-api-guards',
      '--skip-dependency-circular',
      '--skip-tests',
      '--skip-readiness-contracts',
      '--skip-marketing-automation',
      '--skip-open-readiness',
      '--skip-app-route-runtime',
      '--skip-build',
      '--skip-operational-discovery',
      '--json',
      '--report=.tmp/local-release-strict-blocked-contract-report.json',
    ],
    expectedStatus: 'warn',
    allowedStatuses: ['warn', 'blocked'],
    allowedExitCodes: [0, 2],
    clearOperationalEnv: true,
  },
  {
    id: 'local-release-command-timeout-rejected',
    command: process.execPath,
    args: [
      'scripts/verify-local-release-readiness.mjs',
      '--skip-lint',
      '--skip-a11y',
      '--skip-sensitive-api-guards',
      '--skip-dependency-circular',
      '--skip-tests',
      '--skip-readiness-contracts',
      '--skip-marketing-automation',
      '--skip-open-readiness',
      '--skip-app-route-runtime',
      '--skip-build',
      '--skip-operational-inputs',
      '--skip-operational-discovery',
      '--command-timeout-ms=10',
      '--command-timeout-kill-grace-ms=1000',
      '--json',
      '--report=.tmp/local-release-command-timeout-contract-report.json',
    ],
    expectedStatus: 'fail',
    allowedExitCodes: [1],
    allowFailedCount: true,
    forbidLingeringTypeCheckProcesses: true,
    requiredFiles: ['.tmp/local-release-command-timeout-contract-report.json'],
    expectedStdoutIncludes: [
      '"timedOut": true',
      '"commandTimeoutKillGraceMs": 1000',
      'command timed out after 10ms',
    ],
  },
  {
    id: 'marketing-release-command-timeout-rejected',
    command: process.execPath,
    args: [
      'scripts/verify-marketing-release-readiness.mjs',
      '--skip-lint',
      '--skip-marketing-automation',
      '--skip-readiness-contracts',
      '--skip-runtime',
      '--skip-build',
      '--skip-operational-inputs',
      '--skip-operational-discovery',
      '--command-timeout-ms=10',
      '--command-timeout-kill-grace-ms=1000',
      '--json',
      '--report=.tmp/marketing-release-command-timeout-contract-report.json',
    ],
    expectedStatus: 'fail',
    allowedExitCodes: [1],
    allowFailedCount: true,
    forbidLingeringTypeCheckProcesses: true,
    requiredFiles: ['.tmp/marketing-release-command-timeout-contract-report.json'],
    expectedStdoutIncludes: [
      '"timedOut": true',
      '"commandTimeoutKillGraceMs": 1000',
      'command timed out after 10ms',
    ],
  },
  {
    id: 'all-readiness-strict-blocked-exit',
    command: process.execPath,
    args: [
      'scripts/verify-all-readiness.mjs',
      '--strict',
      '--skip-readiness-contracts',
      '--skip-local-release',
      '--skip-build',
      '--skip-runtime',
      '--skip-type-check',
      '--skip-lint',
      '--skip-marketing-automation',
      '--skip-operational-discovery',
      '--json',
      '--report=.tmp/all-readiness-strict-blocked-contract-report.json',
    ],
    expectedStatus: 'warn',
    allowedStatuses: ['warn', 'blocked'],
    allowedExitCodes: [0, 2],
    clearOperationalEnv: true,
  },
  {
    id: 'all-readiness-attention-smoke',
    command: process.execPath,
    args: [
      'scripts/verify-all-readiness.mjs',
      '--strict',
      '--skip-readiness-contracts',
      '--skip-ux-masterplan',
      '--skip-marketing-release',
      '--skip-build',
      '--skip-open-readiness',
      '--skip-app-route-runtime',
      '--skip-type-check',
      '--skip-lint',
      '--skip-a11y',
      '--skip-sensitive-api-guards',
      '--skip-dependency-circular',
      '--skip-tests',
      '--skip-marketing-automation',
      '--skip-operational-discovery',
      '--json',
      '--report=.tmp/all-readiness-attention-contract-report.json',
    ],
    expectedStatus: 'warn',
    allowedStatuses: ['warn', 'blocked'],
    allowedExitCodes: [0, 2],
    clearOperationalEnv: true,
    minAttentionCount: 1,
    requiredAttentionMissing: [
      'GOOGLE_ADS_DEVELOPER_TOKEN',
    ],
    requiredCheckFields: [
      'templatePath',
      'actionPlanPath',
      'applyScriptPath',
      'vercelScriptPath',
      'nodeApplyScriptPath',
      'nodeVercelScriptPath',
    ],
    requiredFiles: [
      '.tmp/full-project-operational-inputs.env.example',
      '.tmp/full-project-operational-inputs-action-plan.md',
      '.tmp/full-project-operational-inputs-apply.sh',
      '.tmp/full-project-operational-inputs-vercel-env.sh',
      '.tmp/full-project-operational-inputs-apply.mjs',
      '.tmp/full-project-operational-inputs-vercel-env.mjs',
    ],
    requiredFileIncludes: {
      '.tmp/full-project-operational-inputs.env.example': [
        'GOOGLE_ADS_DEVELOPER_TOKEN=',
      ],
      '.tmp/full-project-operational-inputs-apply.mjs': [
        'OPERATIONAL_APPLY_DRY_RUN',
        'DRY-RUN gh secret set',
        'DRY-RUN gh variable set',
      ],
      '.tmp/full-project-operational-inputs-vercel-env.mjs': [
        'OPERATIONAL_APPLY_DRY_RUN',
        'DRY-RUN',
        'VERCEL_ENV_TARGETS',
      ],
    },
  },
  {
    id: 'all-readiness-console-guidance-smoke',
    command: process.execPath,
    args: [
      'scripts/verify-all-readiness.mjs',
      '--strict',
      '--skip-readiness-contracts',
      '--skip-ux-masterplan',
      '--skip-marketing-release',
      '--skip-build',
      '--skip-open-readiness',
      '--skip-app-route-runtime',
      '--skip-type-check',
      '--skip-lint',
      '--skip-a11y',
      '--skip-sensitive-api-guards',
      '--skip-dependency-circular',
      '--skip-tests',
      '--skip-marketing-automation',
      '--skip-operational-discovery',
      '--report=.tmp/all-readiness-console-guidance-contract-report.json',
    ],
    allowedExitCodes: [0, 2],
    clearOperationalEnv: true,
    stdoutOnly: true,
    expectedStdoutIncludes: [
      'Attention items:',
      'Operational artifacts:',
      'GOOGLE_ADS_DEVELOPER_TOKEN',
      '.tmp/local-release-operational-inputs-action-plan.md',
      'Report: .tmp/all-readiness-console-guidance-contract-report.json',
    ],
  },
  {
    id: 'all-readiness-report-arg-last-wins',
    command: process.execPath,
    args: [
      'scripts/verify-all-readiness.mjs',
      '--self-test',
      '--json',
      '--report=.tmp/all-readiness-report-arg-first.json',
      '--report=.tmp/all-readiness-report-arg-last.json',
    ],
    expectedStatus: 'pass',
    requiredFiles: ['.tmp/all-readiness-report-arg-last.json'],
    forbiddenFiles: ['.tmp/all-readiness-report-arg-first.json'],
  },
  {
    id: 'all-readiness-empty-stage-rejected',
    command: process.execPath,
    args: [
      'scripts/verify-all-readiness.mjs',
      '--skip-readiness-contracts',
      '--skip-ux-masterplan',
      '--skip-local-release',
      '--skip-marketing-release',
      '--json',
      '--report=.tmp/all-readiness-empty-stage-contract-report.json',
    ],
    expectedStatus: 'fail',
    allowedExitCodes: [1],
    allowFailedCount: true,
    requiredFiles: ['.tmp/all-readiness-empty-stage-contract-report.json'],
    expectedStdoutIncludes: [
      'verify:all selected no stages',
      '"failed": 1',
    ],
  },
  {
    id: 'all-readiness-stage-timeout-rejected',
    command: process.execPath,
    args: [
      'scripts/verify-all-readiness.mjs',
      '--skip-ux-masterplan',
      '--skip-local-release',
      '--skip-marketing-release',
      '--stage-timeout-ms=10',
      '--json',
      '--report=.tmp/all-readiness-stage-timeout-contract-report.json',
    ],
    expectedStatus: 'fail',
    allowedExitCodes: [1],
    allowFailedCount: true,
    requiredFiles: ['.tmp/all-readiness-stage-timeout-contract-report.json'],
    expectedStdoutIncludes: [
      '"timedOut": true',
      'stage timed out after 10ms',
    ],
  },
  {
    id: 'all-readiness-command-timeout-passthrough',
    command: process.execPath,
    args: [
      'scripts/verify-all-readiness.mjs',
      '--skip-readiness-contracts',
      '--skip-ux-masterplan',
      '--skip-marketing-release',
      '--skip-lint',
      '--skip-a11y',
      '--skip-sensitive-api-guards',
      '--skip-dependency-circular',
      '--skip-tests',
      '--skip-marketing-automation',
      '--skip-open-readiness',
      '--skip-app-route-runtime',
      '--skip-build',
      '--skip-operational-discovery',
      '--stage-timeout-ms=60000',
      '--command-timeout-ms',
      '10',
      '--command-timeout-kill-grace-ms',
      '1000',
      '--json',
      '--local-report=.tmp/all-readiness-command-timeout-local-report.json',
      '--report=.tmp/all-readiness-command-timeout-contract-report.json',
    ],
    expectedStatus: 'fail',
    allowedExitCodes: [1],
    allowFailedCount: true,
    forbidLingeringTypeCheckProcesses: true,
    requiredFiles: [
      '.tmp/all-readiness-command-timeout-contract-report.json',
      '.tmp/all-readiness-command-timeout-local-report.json',
    ],
    expectedStdoutIncludes: [
      '"commandTimeoutMs": 10',
      '"commandTimeoutKillGraceMs": 1000',
      'command timed out after 10ms',
    ],
  },
];

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

function typeCheckProcessIds({ stop = false } = {}) {
  if (process.platform !== 'win32') return [];
  const workspace = process.cwd().replace(/'/g, "''");
  const action = stop
    ? 'Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue'
    : 'Write-Output $_.ProcessId';
  const ps = `
    $workspace = '${workspace}'
    Get-CimInstance Win32_Process | Where-Object {
      $_.Name -eq 'node.exe' -and
      $_.CommandLine -like "*$workspace*" -and
      (
        $_.CommandLine -match 'npm-cli\\.js.*run type-check' -or
        $_.CommandLine -match 'cross-env.*tsc --noEmit' -or
        $_.CommandLine -match 'typescript.*bin.*tsc'
      ) -and
      $_.CommandLine -notmatch 'tsserver|typescript-language-server|typingsInstaller'
    } | ForEach-Object { ${action} }
  `;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function envForCheck(check) {
  if (!check.clearOperationalEnv) return process.env;
  const env = { ...process.env };
  for (const key of operationalEnvKeys) {
    delete env[key];
  }
  return env;
}

function runCheck(check) {
  for (const path of [...(check.requiredFiles || []), ...(check.forbiddenFiles || [])]) {
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      // Best effort cleanup; the existence checks below will report any real problem.
    }
  }
  if (check.forbidLingeringTypeCheckProcesses) typeCheckProcessIds({ stop: true });
  const result = spawnSync(check.command, check.args, {
    cwd: process.cwd(),
    env: envForCheck(check),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: check.timeoutMs || checkTimeoutMs,
    windowsHide: true,
  });
  const timedOut = result.error?.code === 'ETIMEDOUT';
  if (timedOut && process.platform === 'win32') {
    // Give Windows a moment to finish terminating any process tree started by the timed-out child.
    spawnSync(process.execPath, [
      '-e',
      `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${checkTimeoutKillGraceMs})`,
    ], { stdio: 'ignore', windowsHide: true });
  }
  const report = parseJson(result.stdout);
  const stdoutOnly = check.stdoutOnly === true;
  const expectedStatus = check.expectedStatus || (stdoutOnly ? '' : 'pass');
  const allowedStatuses = check.allowedStatuses || [expectedStatus];
  const allowedExitCodes = check.allowedExitCodes || [0];
  const failedCount = Number(report?.failed ?? 0);
  const failedCountOk = check.allowFailedCount === true || failedCount === 0;
  const missingExpectedStdout = (check.expectedStdoutIncludes || [])
    .filter((text) => !String(result.stdout || '').includes(text));
  const stdoutOk = missingExpectedStdout.length === 0;
  const missingRequiredFiles = (check.requiredFiles || []).filter((path) => !existsSync(path));
  const presentForbiddenFiles = (check.forbiddenFiles || []).filter((path) => existsSync(path));
  const filesOk = missingRequiredFiles.length === 0 && presentForbiddenFiles.length === 0;
  const missingRequiredFileIncludes = [];
  for (const [path, requiredText] of Object.entries(check.requiredFileIncludes || {})) {
    if (!existsSync(path)) {
      missingRequiredFileIncludes.push(`${path}: file missing`);
      continue;
    }
    const text = readFileSync(path, 'utf8');
    for (const needle of requiredText) {
      if (!text.includes(needle)) missingRequiredFileIncludes.push(`${path}: ${needle}`);
    }
  }
  const fileIncludesOk = missingRequiredFileIncludes.length === 0;
  const attention = Array.isArray(report?.attention) ? report.attention : [];
  const attentionCount = Number(report?.attentionCount ?? attention.length);
  const attentionMissing = [...new Set(attention.flatMap((item) => (
    Array.isArray(item?.missing) ? item.missing : []
  )))];
  const minAttentionCount = Number(check.minAttentionCount ?? 0);
  const missingRequiredAttention = (check.requiredAttentionMissing || []).filter((key) => !attentionMissing.includes(key));
  const attentionOk = attentionCount >= minAttentionCount && missingRequiredAttention.length === 0;
  const reportChecks = Array.isArray(report?.checks) ? report.checks : [];
  const missingRequiredCheckFields = (check.requiredCheckFields || []).filter((field) => (
    !reportChecks.some((item) => item?.[field])
  ));
  const checkFieldsOk = missingRequiredCheckFields.length === 0;
  const lingeringTypeCheckProcesses = check.forbidLingeringTypeCheckProcesses ? typeCheckProcessIds() : [];
  const lingeringOk = lingeringTypeCheckProcesses.length === 0;
  const validationError = [
    missingExpectedStdout.length > 0 ? `missing stdout: ${missingExpectedStdout.join(', ')}` : '',
    missingRequiredFiles.length > 0 ? `missing files: ${missingRequiredFiles.join(', ')}` : '',
    missingRequiredFileIncludes.length > 0 ? `missing file content: ${missingRequiredFileIncludes.join(', ')}` : '',
    presentForbiddenFiles.length > 0 ? `forbidden files present: ${presentForbiddenFiles.join(', ')}` : '',
    lingeringTypeCheckProcesses.length > 0 ? `lingering type-check pids: ${lingeringTypeCheckProcesses.join(', ')}` : '',
    attentionCount < minAttentionCount ? `attentionCount ${attentionCount} < ${minAttentionCount}` : '',
    missingRequiredAttention.length > 0 ? `missing attention keys: ${missingRequiredAttention.join(', ')}` : '',
    missingRequiredCheckFields.length > 0 ? `missing check fields: ${missingRequiredCheckFields.join(', ')}` : '',
  ].filter(Boolean).join('; ');
  const passed = !timedOut
    && allowedExitCodes.includes(result.status)
    && (stdoutOnly || allowedStatuses.includes(report?.status))
    && (stdoutOnly || failedCountOk)
    && stdoutOk
    && filesOk
    && fileIncludesOk
    && lingeringOk
    && attentionOk
    && checkFieldsOk;
  return {
    id: check.id,
    status: passed ? 'pass' : 'fail',
    command: [check.command, ...check.args].join(' '),
    exitCode: result.status,
    signal: result.signal,
    timedOut,
    timeoutMs: check.timeoutMs || checkTimeoutMs,
    passed: Number(report?.passed ?? 0),
    blocked: Number(report?.blocked ?? 0),
    warnings: Number(report?.warnings ?? report?.warned ?? 0),
    failed: Number(report?.failed ?? (passed ? 0 : 1)),
    reportStatus: report?.status || 'unknown',
    expectedStatus: stdoutOnly ? expectedStatus : allowedStatuses.join('|'),
    attentionCount,
    missingRequiredAttention,
    missingRequiredCheckFields,
    missingExpectedStdout,
    missingRequiredFiles,
    missingRequiredFileIncludes,
    presentForbiddenFiles,
    lingeringTypeCheckProcesses,
    error: passed
      ? ''
      : (timedOut
        ? `contract check timed out after ${check.timeoutMs || checkTimeoutMs}ms`
        : (validationError || result.stderr || result.stdout || result.error?.message || '').trim().slice(0, 1200)),
  };
}

const checks = checksToRun.map(runCheck);
const failed = checks.filter((check) => check.status === 'fail');
const report = {
  status: failed.length === 0 ? 'pass' : 'fail',
  passed: checks.filter((check) => check.status === 'pass').length,
  failed: failed.length,
  checkTimeoutMs,
  checkTimeoutKillGraceMs,
  checks,
};

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const check of checks) {
    const suffix = check.error ? ` - ${check.error}` : '';
    console.log(`${check.status.toUpperCase()} ${check.id}${suffix}`);
  }
}

if (failed.length > 0) process.exit(1);
