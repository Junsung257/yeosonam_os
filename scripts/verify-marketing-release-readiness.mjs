#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const rawArgs = process.argv.slice(2);
const runId = `${process.pid}-${Date.now()}`;

function hasFlag(name) {
  return rawArgs.includes(name);
}

function argValue(name, fallback = '') {
  const prefix = `${name}=`;
  const inline = rawArgs.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = rawArgs.indexOf(name);
  return index >= 0 ? rawArgs[index + 1] ?? fallback : fallback;
}

const jsonOutput = hasFlag('--json');
const strict = hasFlag('--strict') || process.env.MARKETING_RELEASE_STRICT === '1';
const skipTypeCheck = hasFlag('--skip-type-check') || process.env.MARKETING_RELEASE_SKIP_TYPE_CHECK === '1';
const skipLint = hasFlag('--skip-lint') || process.env.MARKETING_RELEASE_SKIP_LINT === '1';
const skipRuntime = hasFlag('--skip-runtime') || process.env.MARKETING_RELEASE_SKIP_RUNTIME === '1';
const skipBuild = hasFlag('--skip-build') || process.env.MARKETING_RELEASE_SKIP_BUILD === '1';
const skipOperationalInputs =
  hasFlag('--skip-operational-inputs') || process.env.MARKETING_RELEASE_SKIP_OPERATIONAL_INPUTS === '1';
const skipOperationalDiscovery =
  skipOperationalInputs ||
  hasFlag('--skip-operational-discovery') ||
  process.env.MARKETING_RELEASE_SKIP_OPERATIONAL_DISCOVERY === '1';

const reportPath = argValue('--report', process.env.MARKETING_RELEASE_REPORT_PATH || '');
const explicitOperationalEnvFilePath = argValue(
  '--operational-env-file',
  process.env.MARKETING_RELEASE_OPERATIONAL_INPUTS_ENV_FILE || '',
);
const operationalDiscoveryOutPath = argValue(
  '--operational-discovery-out',
  process.env.MARKETING_RELEASE_OPERATIONAL_DISCOVERY_OUT || '.tmp/marketing-release-operational-inputs-discovered.env',
);
const operationalEnvFilePath = explicitOperationalEnvFilePath || operationalDiscoveryOutPath;
const autoOperationalDiscovery = !skipOperationalDiscovery && !explicitOperationalEnvFilePath;

const operationalTemplatePath = argValue(
  '--operational-template-out',
  process.env.MARKETING_RELEASE_OPERATIONAL_TEMPLATE_OUT || '.tmp/marketing-release-operational-inputs.env.example',
);
const operationalPlanPath = argValue(
  '--operational-plan-out',
  process.env.MARKETING_RELEASE_OPERATIONAL_PLAN_OUT || '.tmp/marketing-release-operational-inputs-action-plan.md',
);
const operationalApplyScriptPath = argValue(
  '--operational-apply-script-out',
  process.env.MARKETING_RELEASE_OPERATIONAL_APPLY_SCRIPT_OUT || '.tmp/marketing-release-operational-inputs-apply.sh',
);
const operationalVercelScriptPath = argValue(
  '--operational-vercel-script-out',
  process.env.MARKETING_RELEASE_OPERATIONAL_VERCEL_SCRIPT_OUT || '.tmp/marketing-release-operational-inputs-vercel-env.sh',
);
const operationalNodeApplyScriptPath = argValue(
  '--operational-node-apply-script-out',
  process.env.MARKETING_RELEASE_OPERATIONAL_NODE_APPLY_SCRIPT_OUT || '.tmp/marketing-release-operational-inputs-apply.mjs',
);
const operationalNodeVercelScriptPath = argValue(
  '--operational-node-vercel-script-out',
  process.env.MARKETING_RELEASE_OPERATIONAL_NODE_VERCEL_SCRIPT_OUT || '.tmp/marketing-release-operational-inputs-vercel-env.mjs',
);

const runtimePort = Number(argValue('--runtime-port', process.env.MARKETING_RELEASE_RUNTIME_PORT || '3033'));
const runtimeMode = argValue('--runtime-mode', process.env.MARKETING_RELEASE_RUNTIME_MODE || 'dev');
const runtimeTimeoutMs = Number(argValue('--runtime-timeout-ms', process.env.MARKETING_RELEASE_RUNTIME_TIMEOUT_MS || '60000'));
const runtimeReadyTimeoutMs = Number(
  argValue('--runtime-ready-timeout-ms', process.env.MARKETING_RELEASE_RUNTIME_READY_TIMEOUT_MS || '120000'),
);

function npmRun(script, args = []) {
  if (process.platform !== 'win32') return ['npm', ['run', script, ...args]];
  const commandLine = ['npm.cmd', 'run', script, ...args].map(quoteWindowsArg).join(' ');
  return ['cmd.exe', ['/d', '/s', '/c', commandLine]];
}

function quoteWindowsArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_/:.=+\-]+$/.test(text)) return text;
  return `"${text.replace(/(["^&|<>()%!])/g, '^$1')}"`;
}

function parseJsonFromOutput(text) {
  const cleaned = String(text || '').replace(/\u0000/g, '');
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first < 0 || last < first) return null;
  try {
    return JSON.parse(cleaned.slice(first, last + 1));
  } catch {
    return null;
  }
}

function ensureParent(path) {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
}

function run(id, command, args, options = {}) {
  const startedAt = process.hrtime.bigint();
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true,
  });
  const durationMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const outLog = `.tmp/marketing-release-${runId}-${id}.out.log`;
  const errLog = `.tmp/marketing-release-${runId}-${id}.err.log`;
  ensureParent(outLog);
  writeFileSync(outLog, stdout);
  writeFileSync(errLog, stderr);

  const parsed = options.parseJson ? parseJsonFromOutput(`${stdout}\n${stderr}`) : null;
  let status = result.status === 0 ? 'pass' : 'fail';
  let passed = status === 'pass' ? 1 : 0;
  let blocked = 0;
  let failed = status === 'fail' ? 1 : 0;
  let warnings = 0;

  if (options.parseJson) {
    const reportStatus = parsed?.status || 'unknown';
    passed = Number(parsed?.passed ?? 0);
    blocked = Number(parsed?.blocked ?? 0);
    failed = Number(parsed?.failed ?? 0);
    warnings = Number(parsed?.warnings ?? parsed?.warned ?? 0);
    if (!parsed) {
      status = 'fail';
      failed = failed || 1;
    } else if (failed > 0 || reportStatus === 'fail') {
      status = 'fail';
    } else if (blocked > 0 || reportStatus === 'blocked') {
      status = 'blocked';
    } else if (warnings > 0 || reportStatus === 'warn') {
      status = 'warn';
    } else {
      status = 'pass';
    }
  }

  return {
    id,
    command: [command, ...args].join(' '),
    status,
    exitCode: result.status,
    durationMs,
    passed,
    blocked,
    failed,
    warnings,
    reportStatus: parsed?.status,
    report: parsed || undefined,
    stdoutLog: outLog,
    stderrLog: errLog,
    error: status === 'fail' ? (stderr || stdout || result.error?.message || '').trim().slice(0, 1200) : '',
  };
}

const checks = [];

if (!skipTypeCheck) {
  const [command, args] = npmRun('type-check');
  checks.push(run('type-check', command, args));
}

if (!skipLint) {
  const [command, args] = npmRun('lint');
  checks.push(run('lint', command, args));
}

checks.push(run(
  'marketing-automation',
  process.execPath,
  ['scripts/verify-marketing-automation-readiness.mjs', '--strict', '--json'],
  { parseJson: true },
));

if (autoOperationalDiscovery) {
  checks.push(run(
    'operational-input-discovery',
    process.execPath,
    ['scripts/discover-operational-readiness-inputs.mjs', '--json', `--out=${operationalDiscoveryOutPath}`],
    { parseJson: true },
  ));
}

if (!skipOperationalInputs) {
  checks.push(run(
    'operational-inputs',
    process.execPath,
    [
      'scripts/verify-operational-readiness-inputs.mjs',
      '--json',
      `--env-file=${operationalEnvFilePath}`,
      `--template-out=${operationalTemplatePath}`,
      `--plan-out=${operationalPlanPath}`,
      `--apply-script-out=${operationalApplyScriptPath}`,
      `--vercel-script-out=${operationalVercelScriptPath}`,
      `--node-apply-script-out=${operationalNodeApplyScriptPath}`,
      `--node-vercel-script-out=${operationalNodeVercelScriptPath}`,
    ],
    { parseJson: true },
  ));
}

if (!skipRuntime) {
  checks.push(run(
    'marketing-runtime-local',
    process.execPath,
    [
      'scripts/verify-marketing-runtime-local.mjs',
      `--port=${runtimePort}`,
      `--mode=${runtimeMode}`,
      `--timeout-ms=${runtimeTimeoutMs}`,
      `--ready-timeout-ms=${runtimeReadyTimeoutMs}`,
    ],
    { parseJson: true },
  ));
}

if (!skipBuild) {
  const [buildCommand, buildArgs] = npmRun('build');
  checks.push(run('build', buildCommand, buildArgs));
  const [bundleCommand, bundleArgs] = npmRun('check:bundle');
  checks.push(run('bundle-budget', bundleCommand, bundleArgs));
}

const failed = checks.filter((check) => check.status === 'fail').length;
const blocked = checks.filter((check) => check.status === 'blocked').length;
const warnings = checks.filter((check) => check.status === 'warn').length;
const passed = checks.filter((check) => check.status === 'pass').length;
const status = failed > 0 ? 'fail' : blocked > 0 ? 'blocked' : warnings > 0 ? 'warn' : 'pass';
const artifacts = {
  operationalEnvFile: operationalEnvFilePath,
  operationalTemplate: operationalTemplatePath,
  operationalPlan: operationalPlanPath,
  operationalApplyScript: operationalApplyScriptPath,
  operationalVercelScript: operationalVercelScriptPath,
  operationalNodeApplyScript: operationalNodeApplyScriptPath,
  operationalNodeVercelScript: operationalNodeVercelScriptPath,
};

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function nestedAttentionItems(report) {
  return Array.isArray(report?.checks)
    ? report.checks
      .filter((item) => item?.status === 'blocked' || item?.status === 'fail' || item?.status === 'warn')
      .slice(0, 10)
      .map((item) => ({
        name: item.name || item.id,
        status: item.status,
        missing: item.missing,
        error: item.error,
        notes: item.notes,
      }))
    : undefined;
}

function summarizeNestedReport(report) {
  if (!report) return {};
  const nestedChecks = Array.isArray(report.checks) ? report.checks : [];
  const nestedBlockers = Array.isArray(report.releaseBlockers) ? report.releaseBlockers : [];
  const missing = uniqueStrings([
    ...(Array.isArray(report.missing) ? report.missing : []),
    ...nestedChecks.flatMap((item) => (Array.isArray(item?.missing) ? item.missing : [])),
    ...nestedBlockers.flatMap((item) => (Array.isArray(item?.missing) ? item.missing : [])),
  ]);
  const attentionChecks = uniqueStrings(
    nestedChecks
      .filter((item) => item?.status === 'blocked' || item?.status === 'fail' || item?.status === 'warn')
      .map((item) => `${item.name || item.id || 'unknown'}(${item.status})`),
  );
  const releaseBlockers = uniqueStrings(
    nestedBlockers
      .filter((item) => item?.status === 'blocked' || item?.status === 'fail' || item?.status === 'warn')
      .map((item) => `${item.name || item.id || 'unknown'}(${item.status})`),
  );
  const notes = uniqueStrings([
    report.status ? `nested status: ${report.status}` : '',
    attentionChecks.length > 0 ? `attention checks: ${attentionChecks.join(', ')}` : '',
    releaseBlockers.length > 0 ? `release blockers: ${releaseBlockers.join(', ')}` : '',
  ]);
  return {
    missing: missing.length > 0 ? missing : undefined,
    notes: notes.length > 0 ? notes.join('; ') : undefined,
  };
}

const report = {
  status,
  strict,
  passed,
  blocked,
  warnings,
  failed,
  total: checks.length,
  skipped: {
    typeCheck: skipTypeCheck,
    lint: skipLint,
    runtime: skipRuntime,
    build: skipBuild,
    operationalInputs: skipOperationalInputs,
    operationalDiscovery: !autoOperationalDiscovery,
  },
  artifacts,
  checks: checks.map(({ report, ...check }) => {
    const summarized = summarizeNestedReport(report);
    const attention = check.status === 'blocked' || check.status === 'fail' || check.status === 'warn'
      ? {
        status: report?.status,
        missing: report?.missing,
        releaseBlockers: report?.releaseBlockers,
        checks: nestedAttentionItems(report),
      }
      : undefined;
    return {
      ...check,
      missing: summarized.missing,
      notes: summarized.notes,
      attention,
    };
  }),
};

if (reportPath) {
  ensureParent(reportPath);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const check of report.checks) {
    const suffix = check.status === 'fail'
      ? ` exit=${check.exitCode}`
      : check.status === 'blocked'
        ? ` blocked=${check.blocked}`
        : check.status === 'warn'
          ? ` warnings=${check.warnings}`
          : '';
    console.log(`${check.status.toUpperCase().padEnd(7)} ${check.id}${suffix} (${check.durationMs}ms)`);
  }
  console.log(`\n[marketing-release-readiness] ${status}: ${passed} passed, ${blocked} blocked, ${failed} failed, ${warnings} warnings`);
}

if (failed > 0) process.exit(1);
if (strict && blocked > 0) process.exit(2);
