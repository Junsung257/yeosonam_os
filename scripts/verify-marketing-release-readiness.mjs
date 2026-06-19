#!/usr/bin/env node

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

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
const skipReadinessContracts =
  hasFlag('--skip-readiness-contracts') || process.env.MARKETING_RELEASE_SKIP_READINESS_CONTRACTS === '1';
const skipMarketingAutomation =
  hasFlag('--skip-marketing-automation') || process.env.MARKETING_RELEASE_SKIP_MARKETING_AUTOMATION === '1';
const skipOperationalInputs =
  hasFlag('--skip-operational-inputs') || process.env.MARKETING_RELEASE_SKIP_OPERATIONAL_INPUTS === '1';
const skipOperationalDiscovery =
  skipOperationalInputs ||
  hasFlag('--skip-operational-discovery') ||
  process.env.MARKETING_RELEASE_SKIP_OPERATIONAL_DISCOVERY === '1';

const reportPath = argValue('--report', process.env.MARKETING_RELEASE_REPORT_PATH || '');
const buildDistDir = argValue(
  '--build-dist-dir',
  process.env.MARKETING_RELEASE_BUILD_DIST_DIR || '.next-marketing-release',
);
const keepBuildDist = hasFlag('--keep-build-dist') || process.env.MARKETING_RELEASE_KEEP_BUILD_DIST === '1';
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
const runtimeTimeoutMs = Number(argValue('--runtime-timeout-ms', process.env.MARKETING_RELEASE_RUNTIME_TIMEOUT_MS || '60000'));
const runtimeReadyTimeoutMs = Number(
  argValue('--runtime-ready-timeout-ms', process.env.MARKETING_RELEASE_RUNTIME_READY_TIMEOUT_MS || '120000'),
);
const commandTimeoutMs = Number(
  argValue('--command-timeout-ms', process.env.MARKETING_RELEASE_COMMAND_TIMEOUT_MS || '900000'),
);
const commandTimeoutKillGraceMs = Number(
  argValue('--command-timeout-kill-grace-ms', process.env.MARKETING_RELEASE_COMMAND_TIMEOUT_KILL_GRACE_MS || '5000'),
);

function killProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    const script = `
      $pending = @(${child.pid})
      $all = @()
      while ($pending.Count -gt 0) {
        $next = @()
        foreach ($id in $pending) {
          $children = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $id }
          foreach ($childProcess in $children) {
            $next += [int]$childProcess.ProcessId
            $all += [int]$childProcess.ProcessId
          }
        }
        $pending = $next
      }
      $all += ${child.pid}
      $all | Sort-Object -Unique -Descending | ForEach-Object {
        Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
      }
    `;
    spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { stdio: 'ignore' });
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

function cleanupLingeringScriptProcesses(script) {
  if (process.platform !== 'win32' || !script) return;
  const escapedWorkspace = process.cwd().replace(/'/g, "''");
  const scriptPattern = script === 'type-check'
    ? 'npm-cli\\.js.*run type-check|cross-env.*tsc --noEmit|typescript.*bin.*tsc'
    : `npm-cli\\.js.*run ${String(script).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
  const escapedPattern = scriptPattern.replace(/'/g, "''");
  const ps = `
    $workspace = '${escapedWorkspace}'
    $pattern = '${escapedPattern}'
    Get-CimInstance Win32_Process | Where-Object {
      $_.Name -eq 'node.exe' -and
      $_.CommandLine -like "*$workspace*" -and
      $_.CommandLine -match $pattern -and
      $_.CommandLine -notmatch 'tsserver|typescript-language-server|typingsInstaller'
    } | ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  `;
  spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { stdio: 'ignore' });
}

function sleepSync(ms) {
  spawnSync(process.execPath, [
    '-e',
    `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${Number(ms) || 0})`,
  ], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

function npmRun(script, args = []) {
  const npmCli = npmCliPath();
  if (npmCli) return [process.execPath, [npmCli, 'run', script, ...args]];
  if (process.platform !== 'win32') return ['npm', ['run', script, ...args]];
  const commandLine = ['npm.cmd', 'run', script, ...args].map(quoteWindowsArg).join(' ');
  return ['cmd.exe', ['/d', '/s', '/c', commandLine]];
}

function npmCliPath() {
  const candidates = [
    process.env.npm_execpath,
    process.env.NPM_CLI_JS,
    process.platform === 'win32'
      ? `${dirname(process.execPath)}\\node_modules\\npm\\bin\\npm-cli.js`
      : `${dirname(process.execPath)}/../lib/node_modules/npm/bin/npm-cli.js`,
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || '';
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

function cleanupBuildDistDir() {
  if (skipBuild) return { skipped: true, reason: 'build skipped' };
  if (keepBuildDist) return { skipped: true, reason: 'requested keep-build-dist', path: buildDistDir };
  if (buildDistDir === '.next') return { skipped: true, reason: 'main .next dist is not ephemeral', path: buildDistDir };

  const root = resolve('.');
  const target = resolve(buildDistDir);
  const relativeTarget = relative(root, target);
  const normalized = relativeTarget.replace(/\\/g, '/');
  const firstSegment = normalized.split('/')[0] || '';
  const unsafe =
    !normalized ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    isAbsolute(relativeTarget) ||
    !firstSegment.startsWith('.next-');

  if (unsafe) {
    return { skipped: true, reason: 'unsafe build dist cleanup target', path: buildDistDir };
  }

  try {
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
      return { skipped: false, removed: true, path: normalized };
    }
    return { skipped: false, removed: false, path: normalized, reason: 'not found' };
  } catch (err) {
    return {
      skipped: false,
      removed: false,
      path: normalized,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function spawnWithTimeout(command, args, env, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let spawnError;
    let stdout = '';
    let stderr = '';
    let forceCloseTimer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (forceCloseTimer) clearTimeout(forceCloseTimer);
      resolve(result);
    };
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true;
        killProcessTree(child);
        forceCloseTimer = setTimeout(() => {
          finish({
            status: null,
            signal: 'SIGTERM',
            stdout,
            stderr,
            error: Object.assign(new Error(`command timed out after ${timeoutMs}ms`), { code: 'ETIMEDOUT' }),
          });
        }, commandTimeoutKillGraceMs);
      }, timeoutMs)
      : null;

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      spawnError = err;
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      finish({
        status: code,
        signal,
        stdout,
        stderr,
        error: timedOut
          ? Object.assign(new Error(`command timed out after ${timeoutMs}ms`), { code: 'ETIMEDOUT' })
          : spawnError,
      });
    });
  });
}

async function run(id, command, args, options = {}) {
  const startedAt = process.hrtime.bigint();
  const env = { ...process.env, ...(options.env || {}) };
  const result = await spawnWithTimeout(command, args, env, commandTimeoutMs);
  const durationMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const timedOut = result.error?.code === 'ETIMEDOUT';
  if (timedOut) {
    cleanupLingeringScriptProcesses(options.scriptName || id);
    sleepSync(750);
    cleanupLingeringScriptProcesses(options.scriptName || id);
  }
  const outLog = `.tmp/marketing-release-${runId}-${id}.out.log`;
  const errLog = `.tmp/marketing-release-${runId}-${id}.err.log`;
  ensureParent(outLog);
  writeFileSync(outLog, stdout);
  writeFileSync(errLog, stderr);

  const parsed = options.parseJson ? parseJsonFromOutput(`${stdout}\n${stderr}`) : null;
  let status = result.status === 0 && !timedOut ? 'pass' : 'fail';
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
    if (timedOut) {
      status = 'fail';
      failed = failed || 1;
    } else if (!parsed) {
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
    signal: result.signal,
    durationMs,
    timeoutMs: commandTimeoutMs,
    timedOut,
    passed,
    blocked,
    failed,
    warnings,
    reportStatus: parsed?.status,
    report: parsed || undefined,
    stdoutLog: outLog,
    stderrLog: errLog,
    env: options.env || {},
    error: status === 'fail'
      ? (timedOut
        ? `command timed out after ${commandTimeoutMs}ms`
        : (stderr || stdout || result.error?.message || '').trim().slice(0, 1200))
      : '',
  };
}

const checks = [];

if (!skipTypeCheck) {
  const [command, args] = npmRun('type-check');
  checks.push(await run('type-check', command, args, { scriptName: 'type-check' }));
}

if (!skipLint) {
  const [command, args] = npmRun('lint');
  checks.push(await run('lint', command, args, { scriptName: 'lint' }));
}

if (!skipMarketingAutomation) {
  checks.push(await run(
    'marketing-automation',
    process.execPath,
    ['scripts/verify-marketing-automation-readiness.mjs', '--strict', '--json'],
    { parseJson: true },
  ));
}

if (!skipReadinessContracts) {
  checks.push(await run(
    'readiness-contracts',
    process.execPath,
    ['scripts/verify-readiness-contracts.mjs', '--json'],
    { parseJson: true },
  ));
}

if (autoOperationalDiscovery) {
  checks.push(await run(
    'operational-input-discovery',
    process.execPath,
    ['scripts/discover-operational-readiness-inputs.mjs', '--json', `--out=${operationalDiscoveryOutPath}`],
    { parseJson: true },
  ));
}

if (!skipOperationalInputs) {
  checks.push(await run(
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
      '--inspect-vercel',
      '--inspect-github',
      '--inspect-management-auth',
      '--inspect-supabase-system-secrets',
    ],
    { parseJson: true },
  ));
}

if (!skipRuntime) {
  checks.push(await run(
    'marketing-runtime-vercel',
    process.execPath,
    [
      'scripts/verify-marketing-runtime-from-vercel.mjs',
      `--port=${runtimePort}`,
      `--timeout-ms=${runtimeTimeoutMs}`,
      `--ready-timeout-ms=${runtimeReadyTimeoutMs}`,
      `--command-timeout-ms=${commandTimeoutMs}`,
      `--hard-timeout-ms=${commandTimeoutMs}`,
      ...(existsSync(operationalEnvFilePath) ? [`--operational-env-file=${operationalEnvFilePath}`] : []),
      ...(skipReadinessContracts ? ['--skip-contract-self-checks'] : []),
      '--json',
      ...(strict ? ['--strict'] : []),
    ],
    { parseJson: true },
  ));
}

if (!skipBuild) {
  const buildEnv = { NEXT_DIST_DIR: buildDistDir };
  const [buildCommand, buildArgs] = npmRun('build');
  checks.push(await run('build', buildCommand, buildArgs, { env: buildEnv, scriptName: 'build' }));
  const [bundleCommand, bundleArgs] = npmRun('check:bundle');
  checks.push(await run('bundle-budget', bundleCommand, bundleArgs, { env: buildEnv, scriptName: 'check:bundle' }));
}

const failed = checks.filter((check) => check.status === 'fail').length;
const blocked = checks.filter((check) => check.status === 'blocked').length;
const checkWarnings = checks.filter((check) => check.status === 'warn').length;
const passed = checks.filter((check) => check.status === 'pass').length;
const buildDistCleanup = cleanupBuildDistDir();
const cleanupWarnings = buildDistCleanup.error ? 1 : 0;
const warnings = checkWarnings + cleanupWarnings;
const status = failed > 0 ? 'fail' : blocked > 0 ? 'blocked' : warnings > 0 ? 'warn' : 'pass';
const artifacts = {
  operationalEnvFile: operationalEnvFilePath,
  operationalTemplate: operationalTemplatePath,
  operationalPlan: operationalPlanPath,
  operationalApplyScript: operationalApplyScriptPath,
  operationalVercelScript: operationalVercelScriptPath,
  operationalNodeApplyScript: operationalNodeApplyScriptPath,
  operationalNodeVercelScript: operationalNodeVercelScriptPath,
  buildDistDir: skipBuild ? undefined : buildDistDir,
  buildDistCleanup,
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
  commandTimeoutMs,
  commandTimeoutKillGraceMs,
  total: checks.length,
  skipped: {
    typeCheck: skipTypeCheck,
    lint: skipLint,
    readinessContracts: skipReadinessContracts,
    marketingAutomation: skipMarketingAutomation,
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
