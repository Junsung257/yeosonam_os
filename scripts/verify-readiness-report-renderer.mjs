#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const json = args.has('--json');
const knownArgs = new Set(['--json', '--timeout-ms']);

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

function exitConfigFailure(errors) {
  const checks = errors.map((error) => ({
    name: 'readiness-renderer-verifier:config',
    status: 'fail',
    error,
  }));
  const report = {
    status: 'fail',
    passed: 0,
    failed: checks.length,
    checks,
  };
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const error of errors) console.error(error);
  }
  process.exit(1);
}

const unknownArgs = rawArgs.filter((arg, index) => {
  if (index > 0 && rawArgs[index - 1] === '--timeout-ms') return false;
  return !knownArgs.has(argKey(arg));
});

if (unknownArgs.length > 0) {
  exitConfigFailure(unknownArgs.map((arg) => `unknown readiness report renderer argument: ${arg}`));
}

const commandTimeoutMs = Number(argValue('--timeout-ms', process.env.READINESS_REPORT_RENDERER_TIMEOUT_MS || '60000'));

if (!Number.isFinite(commandTimeoutMs) || commandTimeoutMs <= 0) {
  exitConfigFailure(['--timeout-ms must be a positive number of milliseconds.']);
}

const outDir = resolve('.tmp', 'readiness-renderer-verify');

function runRenderer(kind) {
  mkdirSync(outDir, { recursive: true });
  const base = resolve(outDir, kind);
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [
    'scripts/render-readiness-report.mjs',
    '--self-test',
    `--kind=${kind}`,
    `--summary-out=${base}-summary.md`,
    `--issue-body-out=${base}-issue.md`,
    `--meta-out=${base}-meta.json`,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: commandTimeoutMs,
    windowsHide: true,
  });
  const timedOut = result.error?.code === 'ETIMEDOUT';
  return {
    kind,
    status: result.status === 0 && !timedOut ? 'pass' : 'fail',
    command: `node scripts/render-readiness-report.mjs --self-test --kind=${kind}`,
    exitCode: result.status,
    signal: result.signal || null,
    timedOut,
    timeoutMs: commandTimeoutMs,
    durationMs: Date.now() - startedAt,
    error: result.error?.message || '',
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    summaryPath: `${base}-summary.md`,
    issuePath: `${base}-issue.md`,
    metaPath: `${base}-meta.json`,
  };
}

function runMissingReportRenderer(kind) {
  mkdirSync(outDir, { recursive: true });
  const base = resolve(outDir, `${kind}-missing`);
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [
    'scripts/render-readiness-report.mjs',
    `--kind=${kind}`,
    `--report=${base}-does-not-exist.json`,
    `--summary-out=${base}-summary.md`,
    `--issue-body-out=${base}-issue.md`,
    `--meta-out=${base}-meta.json`,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: commandTimeoutMs,
    windowsHide: true,
  });
  const timedOut = result.error?.code === 'ETIMEDOUT';
  return {
    kind,
    missingReport: true,
    status: result.status === 0 && !timedOut ? 'pass' : 'fail',
    command: `node scripts/render-readiness-report.mjs --kind=${kind} --report=<missing>`,
    exitCode: result.status,
    signal: result.signal || null,
    timedOut,
    timeoutMs: commandTimeoutMs,
    durationMs: Date.now() - startedAt,
    error: result.error?.message || '',
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    summaryPath: `${base}-summary.md`,
    issuePath: `${base}-issue.md`,
    metaPath: `${base}-meta.json`,
  };
}

function runWarningOnlyRenderer(kind) {
  mkdirSync(outDir, { recursive: true });
  const base = resolve(outDir, `${kind}-warning-only`);
  const reportPath = `${base}-report.json`;
  writeFileSync(reportPath, `${JSON.stringify({
    status: 'pass',
    passed: 1,
    blocked: 0,
    failed: 0,
    total: 1,
    releaseWarnings: [{
      source: 'operational-inputs',
      name: 'runtime-defaults',
      status: 'warn',
      notes: 'sample default env',
      missing: ['AD_FLAG_UP_BID_FACTOR'],
      alternatives: ['AD_OFFPEAK_BID_FACTOR'],
    }],
    checks: [
      { id: 'type-check', status: 'pass', durationMs: 11 },
    ],
  }, null, 2)}\n`);
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [
    'scripts/render-readiness-report.mjs',
    `--kind=${kind}`,
    `--report=${reportPath}`,
    `--summary-out=${base}-summary.md`,
    `--issue-body-out=${base}-issue.md`,
    `--meta-out=${base}-meta.json`,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: commandTimeoutMs,
    windowsHide: true,
  });
  const timedOut = result.error?.code === 'ETIMEDOUT';
  return {
    kind,
    warningOnly: true,
    status: result.status === 0 && !timedOut ? 'pass' : 'fail',
    command: `node scripts/render-readiness-report.mjs --kind=${kind} --report=<warning-only>`,
    exitCode: result.status,
    signal: result.signal || null,
    timedOut,
    timeoutMs: commandTimeoutMs,
    durationMs: Date.now() - startedAt,
    error: result.error?.message || '',
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    summaryPath: `${base}-summary.md`,
    issuePath: `${base}-issue.md`,
    metaPath: `${base}-meta.json`,
  };
}

function runInconsistentBlockerRenderer(kind) {
  mkdirSync(outDir, { recursive: true });
  const base = resolve(outDir, `${kind}-inconsistent-blocker`);
  const reportPath = `${base}-report.json`;
  writeFileSync(reportPath, `${JSON.stringify({
    status: 'pass',
    passed: 1,
    blocked: 0,
    failed: 0,
    warnings: 0,
    total: 1,
    releaseBlockers: [{
      source: 'contract-self-test',
      name: 'stale-blocker',
      status: 'blocked',
      notes: 'sample stale blocker on otherwise passing report',
      missing: ['SERPAPI_KEY'],
    }],
    checks: [
      { id: 'type-check', status: 'pass', durationMs: 11 },
    ],
  }, null, 2)}\n`);
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [
    'scripts/render-readiness-report.mjs',
    `--kind=${kind}`,
    `--report=${reportPath}`,
    `--summary-out=${base}-summary.md`,
    `--issue-body-out=${base}-issue.md`,
    `--meta-out=${base}-meta.json`,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: commandTimeoutMs,
    windowsHide: true,
  });
  const timedOut = result.error?.code === 'ETIMEDOUT';
  return {
    kind,
    inconsistentBlocker: true,
    status: result.status === 0 && !timedOut ? 'pass' : 'fail',
    command: `node scripts/render-readiness-report.mjs --kind=${kind} --report=<inconsistent-blocker>`,
    exitCode: result.status,
    signal: result.signal || null,
    timedOut,
    timeoutMs: commandTimeoutMs,
    durationMs: Date.now() - startedAt,
    error: result.error?.message || '',
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    summaryPath: `${base}-summary.md`,
    issuePath: `${base}-issue.md`,
    metaPath: `${base}-meta.json`,
  };
}

function readRequired(path) {
  if (!existsSync(path)) throw new Error(`missing output: ${path}`);
  return readFileSync(path, 'utf8');
}

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`${label} missing "${needle}"`);
}

function isReleaseKind(kind) {
  return kind === 'local-release' || kind === 'marketing-release';
}

function isFullProjectKind(kind) {
  return kind === 'full-project';
}

function expectedHeadingFor(kind) {
  if (kind === 'local-release') return 'Local Release Readiness Attention Items';
  if (kind === 'marketing-release') return 'Marketing Release Readiness Attention Items';
  if (kind === 'full-project') return 'Full Project Readiness Attention Items';
  return 'Open Readiness Attention Items';
}

function expectedBlockerSectionFor(kind) {
  if (isReleaseKind(kind)) return '## Release Blockers';
  if (isFullProjectKind(kind)) return '## Project Attention Blockers';
  return '## Readiness Attention';
}

function verifyOutput(run) {
  if (run.status !== 'pass') {
    if (run.timedOut) {
      throw new Error(`renderer command timed out after ${run.timeoutMs}ms`);
    }
    throw new Error((run.stderr || run.stdout || run.error || `${run.kind} renderer failed`).trim());
  }
  const meta = JSON.parse(readRequired(run.metaPath));
  const summary = readRequired(run.summaryPath);
  const issue = readRequired(run.issuePath);

  assertIncludes(summary, expectedBlockerSectionFor(run.kind), `${run.kind} summary`);
  assertIncludes(summary, 'Warnings:', `${run.kind} summary`);
  assertIncludes(issue, 'Warnings:', `${run.kind} issue`);
  assertIncludes(issue, meta.marker, `${run.kind} issue`);
  assertIncludes(issue, expectedHeadingFor(run.kind), `${run.kind} issue`);

  if (meta.kind !== run.kind) throw new Error(`${run.kind} meta kind mismatch`);
  if (!Array.isArray(meta.legacyIssueTitles) || meta.legacyIssueTitles.length < 1) {
    throw new Error(`${run.kind} legacy issue titles missing`);
  }
  assertIncludes(meta.legacyIssueTitles.join('\n'), 'blockers', `${run.kind} legacy titles`);
  const expectedStatus = run.missingReport || run.warningOnly || run.inconsistentBlocker
    ? run.missingReport ? 'missing' : 'pass'
    : 'blocked';
  if (meta.status !== expectedStatus) throw new Error(`${run.kind} meta status mismatch`);
  const expectedHasReport = !run.missingReport;
  if (meta.hasReport !== expectedHasReport || !meta.hasAttentionItems || meta.shouldCloseIssue) {
    throw new Error(`${run.kind} meta blocker flags mismatch`);
  }
  if (run.warningOnly) {
    if (meta.hasBlockers || !meta.hasWarnings) {
      throw new Error(`${run.kind} warning-only flags mismatch`);
    }
  } else if (!meta.hasBlockers) {
    throw new Error(`${run.kind} blocker flag missing`);
  }
  if (!run.missingReport && !run.inconsistentBlocker && !meta.hasWarnings) {
    throw new Error(`${run.kind} meta warning flag missing`);
  }
  if (!run.warningOnly && Number(meta.blockerCount) < 1) throw new Error(`${run.kind} blockerCount missing`);
  if (!run.missingReport && !run.inconsistentBlocker && Number(meta.warningCount) < 1) {
    throw new Error(`${run.kind} warningCount missing`);
  }
  if (isReleaseKind(run.kind)) {
    assertIncludes(summary, '| Check | Status | Duration ms | Failed | Blocked |', `${run.kind} summary`);
    if (!run.warningOnly) {
      assertIncludes(issue, '| Source | Name | Status | Notes |', `${run.kind} issue`);
    }
  } else if (isFullProjectKind(run.kind)) {
    assertIncludes(summary, '| Stage | Status | Duration ms | Passed | Blocked | Failed | Warnings |', 'full-project summary');
    if (!run.warningOnly) {
      assertIncludes(issue, '| Stage | Source | Name | Status | Missing | Notes |', 'full-project issue');
    }
  } else {
    assertIncludes(summary, '| Check | Status | Duration ms | Notes |', 'open summary');
    if (!run.warningOnly) {
      assertIncludes(issue, '| Name | Status | Notes |', 'open issue');
    }
  }
  if (run.warningOnly) {
    assertIncludes(issue, 'No blockers reported.', `${run.kind} warning-only issue`);
  }
  if (!run.missingReport && !run.warningOnly && !run.inconsistentBlocker && !isFullProjectKind(run.kind)) {
    assertIncludes(summary, '## Operational Artifacts', `${run.kind} summary`);
    assertIncludes(issue, '## Operational Artifacts', `${run.kind} issue`);
    assertIncludes(summary, 'Action plan', `${run.kind} summary`);
    assertIncludes(issue, 'Action plan', `${run.kind} issue`);
    assertIncludes(summary, 'Apply script', `${run.kind} summary`);
    assertIncludes(issue, 'Apply script', `${run.kind} issue`);
    assertIncludes(summary, 'Vercel env script', `${run.kind} summary`);
    assertIncludes(issue, 'Vercel env script', `${run.kind} issue`);
    assertIncludes(summary, 'Node apply script', `${run.kind} summary`);
    assertIncludes(issue, 'Node apply script', `${run.kind} issue`);
    assertIncludes(summary, 'Node Vercel env script', `${run.kind} summary`);
    assertIncludes(issue, 'Node Vercel env script', `${run.kind} issue`);
    assertIncludes(summary, 'Env file', `${run.kind} summary`);
    assertIncludes(issue, 'Env file', `${run.kind} issue`);
    assertIncludes(summary, '## Missing Inputs', `${run.kind} summary`);
    assertIncludes(issue, '## Missing Inputs', `${run.kind} issue`);
    assertIncludes(summary, 'Preferred Location', `${run.kind} summary`);
    assertIncludes(issue, 'Preferred Location', `${run.kind} issue`);
    assertIncludes(summary, 'GitHub Actions secret', `${run.kind} summary`);
    assertIncludes(issue, 'GitHub Actions secret', `${run.kind} issue`);
    assertIncludes(summary, 'SERPAPI_KEY', `${run.kind} summary`);
    assertIncludes(issue, 'SERPAPI_KEY', `${run.kind} issue`);
    if (run.kind === 'open') {
      assertIncludes(summary, 'public:blog-surface-monitor', 'open summary');
      assertIncludes(issue, 'public:blog-surface-monitor', 'open issue');
      assertIncludes(summary, 'public:blog-search-quality', 'open summary');
      assertIncludes(issue, 'public:blog-search-quality', 'open issue');
      assertIncludes(summary, 'scores: strict=0, fleet=28', 'open summary');
      assertIncludes(issue, 'scores: strict=0, fleet=28', 'open issue');
      assertIncludes(summary, 'issue counts: render_integrity.blocked_items=1', 'open summary');
      assertIncludes(issue, 'issue counts: render_integrity.blocked_items=1', 'open issue');
      assertIncludes(summary, 'auth: dev-admin-cookie', 'open summary');
      assertIncludes(issue, 'auth: dev-admin-cookie', 'open issue');
      assertIncludes(summary, 'blog-list:db_unavailable_page', 'open summary');
      assertIncludes(issue, 'blog-list:db_unavailable_page', 'open issue');
      assertIncludes(summary, 'surfaces: checked=11, failed=2, warn=1', 'open summary');
      assertIncludes(issue, 'surfaces: checked=11, failed=2, warn=1', 'open issue');
      assertIncludes(summary, 'local:marketing-runtime', 'open summary');
      assertIncludes(issue, 'local:marketing-runtime', 'open issue');
      assertIncludes(summary, 'attention checks: live:dev-admin-cookie(blocked)', 'open summary');
      assertIncludes(issue, 'attention checks: live:dev-admin-cookie(blocked)', 'open issue');
    } else if (run.kind === 'local-release') {
      assertIncludes(summary, 'Operational env file', 'local-release summary');
      assertIncludes(issue, 'Operational env file', 'local-release issue');
      assertIncludes(summary, '.tmp/local-release-operational-inputs-discovered.env', 'local-release summary');
      assertIncludes(issue, '.tmp/local-release-operational-inputs-discovered.env', 'local-release issue');
      assertIncludes(summary, 'public:blog-surface-monitor', 'local-release summary');
      assertIncludes(issue, 'public:blog-surface-monitor', 'local-release issue');
      assertIncludes(summary, 'public:blog-search-quality', 'local-release summary');
      assertIncludes(issue, 'public:blog-search-quality', 'local-release issue');
      assertIncludes(summary, 'scores: strict=0, fleet=28', 'local-release summary');
      assertIncludes(issue, 'scores: strict=0, fleet=28', 'local-release issue');
      assertIncludes(summary, 'issue counts: render_integrity.blocked_items=1', 'local-release summary');
      assertIncludes(issue, 'issue counts: render_integrity.blocked_items=1', 'local-release issue');
      assertIncludes(summary, 'auth: dev-admin-cookie', 'local-release summary');
      assertIncludes(issue, 'auth: dev-admin-cookie', 'local-release issue');
      assertIncludes(summary, 'blog-list:db_unavailable_page', 'local-release summary');
      assertIncludes(issue, 'blog-list:db_unavailable_page', 'local-release issue');
      assertIncludes(summary, 'surfaces: checked=11, failed=2, warn=1', 'local-release summary');
      assertIncludes(issue, 'surfaces: checked=11, failed=2, warn=1', 'local-release issue');
      assertIncludes(summary, 'local:marketing-runtime', 'local-release summary');
      assertIncludes(issue, 'local:marketing-runtime', 'local-release issue');
      assertIncludes(summary, 'attention checks: live:dev-admin-cookie(blocked)', 'local-release summary');
      assertIncludes(issue, 'attention checks: live:dev-admin-cookie(blocked)', 'local-release issue');
    } else if (run.kind === 'marketing-release') {
      assertIncludes(summary, 'Operational env file', 'marketing-release summary');
      assertIncludes(issue, 'Operational env file', 'marketing-release issue');
      assertIncludes(summary, '.tmp/marketing-release-operational-inputs-discovered.env', 'marketing-release summary');
      assertIncludes(issue, '.tmp/marketing-release-operational-inputs-discovered.env', 'marketing-release issue');
      assertIncludes(summary, 'marketing-automation', 'marketing-release summary');
      assertIncludes(summary, 'operational-input-discovery', 'marketing-release summary');
      assertIncludes(issue, 'operational-input-discovery', 'marketing-release issue');
      assertIncludes(summary, 'MARKETING_CHECK_CARD_NEWS_ID', 'marketing-release summary');
      assertIncludes(issue, 'MARKETING_CHECK_CARD_NEWS_ID', 'marketing-release issue');
      assertIncludes(summary, 'marketing-runtime-vercel', 'marketing-release summary');
      assertIncludes(issue, 'marketing-runtime-vercel', 'marketing-release issue');
      assertIncludes(summary, 'vercel:marketing-runtime', 'marketing-release summary');
      assertIncludes(issue, 'vercel:marketing-runtime', 'marketing-release issue');
      assertIncludes(summary, 'attention checks: live:dev-admin-cookie(blocked)', 'marketing-release summary');
      assertIncludes(issue, 'attention checks: live:dev-admin-cookie(blocked)', 'marketing-release issue');
    }
  }
  if (!run.missingReport && !run.warningOnly && !run.inconsistentBlocker && isFullProjectKind(run.kind)) {
    assertIncludes(summary, 'Warnings: 1', 'full-project summary');
    assertIncludes(issue, 'Warnings: 1', 'full-project issue');
    assertIncludes(summary, '## Operational Artifacts', 'full-project summary');
    assertIncludes(issue, '## Operational Artifacts', 'full-project issue');
    assertIncludes(summary, 'Action plan', 'full-project summary');
    assertIncludes(issue, 'Action plan', 'full-project issue');
    assertIncludes(summary, 'Node Vercel env script', 'full-project summary');
    assertIncludes(issue, 'Node Vercel env script', 'full-project issue');
    assertIncludes(summary, '.tmp/local-release-operational-inputs-action-plan.md', 'full-project summary');
    assertIncludes(issue, '.tmp/local-release-operational-inputs-action-plan.md', 'full-project issue');
    assertIncludes(summary, 'local-release', 'full-project summary');
    assertIncludes(issue, 'local-release', 'full-project issue');
    assertIncludes(summary, 'runtime-integrations', 'full-project summary');
    assertIncludes(issue, 'runtime-integrations', 'full-project issue');
    assertIncludes(summary, 'SERPAPI_KEY', 'full-project summary');
    assertIncludes(issue, 'SERPAPI_KEY', 'full-project issue');
    assertIncludes(summary, 'GOOGLE_ADS_DEVELOPER_TOKEN', 'full-project summary');
    assertIncludes(issue, 'GOOGLE_ADS_DEVELOPER_TOKEN', 'full-project issue');
  }
  if (!run.missingReport && !run.inconsistentBlocker) {
    assertIncludes(summary, '## Release Warnings', `${run.kind} summary`);
    assertIncludes(issue, '## Release Warnings', `${run.kind} issue`);
    assertIncludes(summary, '| Source | Name | Status | Preferred Location | Notes |', `${run.kind} warning summary`);
    assertIncludes(issue, '| Source | Name | Status | Preferred Location | Notes |', `${run.kind} warning issue`);
    assertIncludes(summary, 'GitHub Actions variable', `${run.kind} summary`);
    assertIncludes(issue, 'GitHub Actions variable', `${run.kind} issue`);
    if (isFullProjectKind(run.kind) && !run.warningOnly) {
      assertIncludes(summary, 'AD_MIN_BID_KRW', `${run.kind} summary`);
      assertIncludes(issue, 'AD_MIN_BID_KRW', `${run.kind} issue`);
    } else {
      assertIncludes(summary, 'AD_FLAG_UP_BID_FACTOR', `${run.kind} summary`);
      assertIncludes(issue, 'AD_FLAG_UP_BID_FACTOR', `${run.kind} issue`);
      assertIncludes(summary, 'alternatives: AD_OFFPEAK_BID_FACTOR', `${run.kind} summary`);
      assertIncludes(issue, 'alternatives: AD_OFFPEAK_BID_FACTOR', `${run.kind} issue`);
    }
  }

  return {
    name: run.inconsistentBlocker
      ? `readiness-renderer:${run.kind}:inconsistent-blocker`
      : run.warningOnly
      ? `readiness-renderer:${run.kind}:warning-only`
      : run.missingReport
      ? `readiness-renderer:${run.kind}:missing-report`
      : `readiness-renderer:${run.kind}`,
    status: 'pass',
    exitCode: run.exitCode,
    signal: run.signal,
    timedOut: run.timedOut,
    timeoutMs: run.timeoutMs,
    durationMs: run.durationMs,
    metaPath: run.metaPath,
    summaryPath: run.summaryPath,
    issuePath: run.issuePath,
  };
}

const checks = [];

for (const kind of ['open', 'local-release', 'marketing-release', 'full-project']) {
  for (const run of [
    runRenderer(kind),
    runMissingReportRenderer(kind),
    runWarningOnlyRenderer(kind),
    runInconsistentBlockerRenderer(kind),
  ]) {
    try {
      checks.push(verifyOutput(run));
    } catch (err) {
      checks.push({
        name: run.inconsistentBlocker
          ? `readiness-renderer:${kind}:inconsistent-blocker`
          : run.warningOnly
          ? `readiness-renderer:${kind}:warning-only`
          : run.missingReport
          ? `readiness-renderer:${kind}:missing-report`
          : `readiness-renderer:${kind}`,
        status: 'fail',
        command: run.command,
        error: err instanceof Error ? err.message : String(err),
        exitCode: run.exitCode,
        signal: run.signal,
        timedOut: run.timedOut,
        timeoutMs: run.timeoutMs,
        durationMs: run.durationMs,
        stderr: run.stderr.trim(),
        stdout: run.stdout.trim(),
      });
    }
  }
}

const failed = checks.filter((check) => check.status === 'fail');
const report = {
  status: failed.length === 0 ? 'pass' : 'fail',
  passed: checks.length - failed.length,
  failed: failed.length,
  timeoutMs: commandTimeoutMs,
  checks,
};

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const check of checks) {
    const suffix = check.error ? ` - ${check.error}` : '';
    console.log(`${check.status.toUpperCase()} ${check.name}${suffix}`);
  }
}

if (failed.length > 0) process.exit(1);
