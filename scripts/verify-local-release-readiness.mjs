#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

const rawArgs = process.argv.slice(2);
const runId = `${process.pid}-${Date.now()}`;

function argValue(name, fallback = '') {
  const prefix = `${name}=`;
  const inline = rawArgs.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = rawArgs.indexOf(name);
  return index >= 0 ? rawArgs[index + 1] ?? fallback : fallback;
}

function hasFlag(name) {
  return rawArgs.includes(name);
}

const jsonOutput = hasFlag('--json');
const skipTypeCheck = hasFlag('--skip-type-check') || process.env.LOCAL_RELEASE_SKIP_TYPE_CHECK === '1';
const skipLint = hasFlag('--skip-lint') || process.env.LOCAL_RELEASE_SKIP_LINT === '1';
const skipA11y = hasFlag('--skip-a11y') || process.env.LOCAL_RELEASE_SKIP_A11Y === '1';
const skipSensitiveApiGuards =
  hasFlag('--skip-sensitive-api-guards') ||
  process.env.LOCAL_RELEASE_SKIP_SENSITIVE_API_GUARDS === '1';
const skipDependencyCircular =
  hasFlag('--skip-dependency-circular') ||
  process.env.LOCAL_RELEASE_SKIP_DEPENDENCY_CIRCULAR === '1';
const skipTests = hasFlag('--skip-tests');
const skipReadinessContracts =
  hasFlag('--skip-readiness-contracts') ||
  process.env.LOCAL_RELEASE_SKIP_READINESS_CONTRACTS === '1';
const skipUxMasterplan =
  hasFlag('--skip-ux-masterplan') ||
  process.env.LOCAL_RELEASE_SKIP_UX_MASTERPLAN === '1';
const skipMarketingAutomation =
  hasFlag('--skip-marketing-automation') ||
  process.env.LOCAL_RELEASE_SKIP_MARKETING_AUTOMATION === '1';
const skipBuild = hasFlag('--skip-build');
const skipOpenReadiness = hasFlag('--skip-open-readiness');
const skipAppRouteRuntime =
  hasFlag('--skip-app-route-runtime') ||
  process.env.LOCAL_RELEASE_SKIP_APP_ROUTE_RUNTIME === '1';
const skipOperationalInputs = hasFlag('--skip-operational-inputs');
const skipOperationalDiscovery = skipOperationalInputs ||
  hasFlag('--skip-operational-discovery') ||
  process.env.LOCAL_RELEASE_SKIP_OPERATIONAL_DISCOVERY === '1';
const strict = hasFlag('--strict') || process.env.LOCAL_RELEASE_STRICT === '1';
const strictOpenReadiness = hasFlag('--strict-open');
const reportPath = argValue('--report', process.env.LOCAL_RELEASE_REPORT_PATH || '');
const buildDistDir = argValue('--build-dist-dir', process.env.LOCAL_RELEASE_BUILD_DIST_DIR || '.next-local-release');
const keepBuildDist = hasFlag('--keep-build-dist') || process.env.LOCAL_RELEASE_KEEP_BUILD_DIST === '1';
const operationalInputsTemplatePath = argValue(
  '--operational-template-out',
  process.env.LOCAL_RELEASE_OPERATIONAL_INPUTS_TEMPLATE_OUT || '.tmp/local-release-operational-inputs.env.example',
);
const operationalInputsPlanPath = argValue(
  '--operational-plan-out',
  process.env.LOCAL_RELEASE_OPERATIONAL_INPUTS_PLAN_OUT || '.tmp/local-release-operational-inputs-action-plan.md',
);
const operationalInputsApplyScriptPath = argValue(
  '--operational-apply-script-out',
  process.env.LOCAL_RELEASE_OPERATIONAL_INPUTS_APPLY_SCRIPT_OUT || '.tmp/local-release-operational-inputs-apply.sh',
);
const operationalInputsVercelScriptPath = argValue(
  '--operational-vercel-script-out',
  process.env.LOCAL_RELEASE_OPERATIONAL_INPUTS_VERCEL_SCRIPT_OUT || '.tmp/local-release-operational-inputs-vercel-env.sh',
);
const operationalInputsNodeApplyScriptPath = argValue(
  '--operational-node-apply-script-out',
  process.env.LOCAL_RELEASE_OPERATIONAL_INPUTS_NODE_APPLY_SCRIPT_OUT || '.tmp/local-release-operational-inputs-apply.mjs',
);
const operationalInputsNodeVercelScriptPath = argValue(
  '--operational-node-vercel-script-out',
  process.env.LOCAL_RELEASE_OPERATIONAL_INPUTS_NODE_VERCEL_SCRIPT_OUT || '.tmp/local-release-operational-inputs-vercel-env.mjs',
);
const explicitOperationalInputsEnvFilePath = argValue(
  '--operational-env-file',
  process.env.LOCAL_RELEASE_OPERATIONAL_INPUTS_ENV_FILE || '',
);
const operationalDiscoveryOutPath = argValue(
  '--operational-discovery-out',
  process.env.LOCAL_RELEASE_OPERATIONAL_DISCOVERY_OUT || '.tmp/local-release-operational-inputs-discovered.env',
);
const autoOperationalDiscovery = !skipOperationalDiscovery && !explicitOperationalInputsEnvFilePath;
let operationalInputsEnvFilePath = explicitOperationalInputsEnvFilePath || (autoOperationalDiscovery ? operationalDiscoveryOutPath : '');
const operationalEnvFilePath = operationalInputsEnvFilePath;

const openPort = Number(argValue('--open-port', process.env.LOCAL_RELEASE_OPEN_PORT || '3044'));
const openMode = argValue('--open-mode', process.env.LOCAL_RELEASE_OPEN_MODE || 'dev');
const openTimeoutMs = Number(argValue('--open-timeout-ms', process.env.LOCAL_RELEASE_OPEN_TIMEOUT_MS || '30000'));
const openReadyTimeoutMs = Number(
  argValue('--open-ready-timeout-ms', process.env.LOCAL_RELEASE_OPEN_READY_TIMEOUT_MS || '120000'),
);
const marketingRuntimeTimeoutMs = Number(
  argValue('--marketing-runtime-timeout-ms', process.env.LOCAL_RELEASE_MARKETING_RUNTIME_TIMEOUT_MS || '60000'),
);
const marketingRuntimeReadyTimeoutMs = Number(
  argValue(
    '--marketing-runtime-ready-timeout-ms',
    process.env.LOCAL_RELEASE_MARKETING_RUNTIME_READY_TIMEOUT_MS || '120000',
  ),
);
const marketingRuntimeHardTimeoutMs = Number(
  argValue(
    '--marketing-runtime-hard-timeout-ms',
    process.env.LOCAL_RELEASE_MARKETING_RUNTIME_HARD_TIMEOUT_MS || '0',
  ),
);
const appRouteRuntimePort = Number(
  argValue('--app-route-runtime-port', process.env.LOCAL_RELEASE_APP_ROUTE_RUNTIME_PORT || '3052'),
);
const appRouteRuntimeMode = argValue(
  '--app-route-runtime-mode',
  process.env.LOCAL_RELEASE_APP_ROUTE_RUNTIME_MODE || 'dev',
);
const appRouteRuntimeTimeoutMs = Number(
  argValue('--app-route-runtime-timeout-ms', process.env.LOCAL_RELEASE_APP_ROUTE_RUNTIME_TIMEOUT_MS || '30000'),
);
const appRouteRuntimeReadyTimeoutMs = Number(
  argValue(
    '--app-route-runtime-ready-timeout-ms',
    process.env.LOCAL_RELEASE_APP_ROUTE_RUNTIME_READY_TIMEOUT_MS || '120000',
  ),
);
const appRouteRuntimeAttempts = Number(
  argValue('--app-route-runtime-attempts', process.env.LOCAL_RELEASE_APP_ROUTE_RUNTIME_ATTEMPTS || '2'),
);
const commandTimeoutMs = Number(
  argValue('--command-timeout-ms', process.env.LOCAL_RELEASE_COMMAND_TIMEOUT_MS || '900000'),
);
const commandTimeoutKillGraceMs = Number(
  argValue('--command-timeout-kill-grace-ms', process.env.LOCAL_RELEASE_COMMAND_TIMEOUT_KILL_GRACE_MS || '5000'),
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
  if (process.platform !== 'win32') return;
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

function parseEnvLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trimStart() : trimmed;
  const equalIndex = normalized.indexOf('=');
  if (equalIndex <= 0) return null;
  const key = normalized.slice(0, equalIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  let value = normalized.slice(equalIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  value = value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"');
  return [key, value];
}

function loadOperationalEnvFile(path) {
  if (!path) return { path: '', loadedKeys: [], error: '' };
  try {
    const loadedKeys = [];
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      const [key, value] = parsed;
      if (!String(process.env[key] || '').trim()) process.env[key] = value;
      loadedKeys.push(key);
    }
    return { path, loadedKeys: [...new Set(loadedKeys)].sort(), error: '' };
  } catch (err) {
    return { path, loadedKeys: [], error: err instanceof Error ? err.message : String(err) };
  }
}

let operationalEnvFileLoad = explicitOperationalInputsEnvFilePath
  ? loadOperationalEnvFile(explicitOperationalInputsEnvFilePath)
  : { path: '', loadedKeys: [], error: '' };

function npmRunInvocation(script, args) {
  const npmCli = npmCliPath();
  if (npmCli) {
    return {
      command: process.execPath,
      args: [npmCli, 'run', script, ...args],
    };
  }

  if (process.platform !== 'win32') {
    return {
      command: 'npm',
      args: ['run', script, ...args],
    };
  }

  const commandLine = ['npm.cmd', 'run', script, ...args].map(quoteWindowsArg).join(' ');
  return {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', commandLine],
  };
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

function elapsedMs(startedAt) {
  return Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
}

function tailLines(value, lineCount = 80) {
  const lines = String(value || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(Boolean);
  return lines.slice(-lineCount).join('\n');
}

function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function tailFile(path, lineCount = 80) {
  return tailLines(readText(path), lineCount);
}

function outputPath(id, streamName) {
  mkdirSync('.tmp', { recursive: true });
  const safeId = id.replace(/[^A-Za-z0-9_.-]+/g, '-');
  return resolve('.tmp', `local-release-${runId}-${safeId}.${streamName}.log`);
}

function writeReport(path, report) {
  if (!path) return;
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
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

function combinedOutput(result) {
  return `${readText(result.stdoutPath)}\n${readText(result.stderrPath)}`;
}

function parseJsonObjects(output) {
  const text = String(output || '');
  const objects = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{') continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
      const char = text[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          const candidate = text.slice(start, index + 1);
          try {
            objects.push({ value: JSON.parse(candidate), length: candidate.length });
          } catch {
            // Keep scanning; command banners can contain braces that are not JSON.
          }
          break;
        }
      }
    }
  }
  return objects;
}

function parseJsonFromOutput(output) {
  return parseJsonObjects(output)
    .filter(({ value }) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      return (
        'status' in value ||
        'failed' in value ||
        'blocked' in value ||
        'checks' in value ||
        'summary' in value
      );
    })
    .sort((a, b) => b.length - a.length)[0]?.value;
}

function numericField(report, key) {
  const direct = Number(report?.[key]);
  if (Number.isFinite(direct)) return direct;
  const nested = Number(report?.summary?.[key]);
  return Number.isFinite(nested) ? nested : 0;
}

function statusField(report) {
  return String(report?.status ?? report?.summary?.status ?? '').toLowerCase();
}

function summarizeOpenReadinessBlockers(report) {
  if (!report || !Array.isArray(report.checks)) return [];
  return report.checks
    .filter((check) => check?.status === 'blocked' || check?.status === 'fail')
    .map((check) => ({
      name: String(check.name || check.id || 'unknown'),
      status: String(check.status || 'unknown'),
      notes: check.notes || check.error || '',
      missing: Array.isArray(check.missing) ? check.missing : undefined,
      usingDefaults: Array.isArray(check.usingDefaults) ? check.usingDefaults : undefined,
      failedRequiredChecks: Array.isArray(check.failedRequiredChecks)
        ? check.failedRequiredChecks
        : undefined,
      issueCounts: check.issueCounts && typeof check.issueCounts === 'object' ? check.issueCounts : undefined,
      strictScore: Number.isFinite(Number(check.strictScore)) ? Number(check.strictScore) : undefined,
      fleetScore: Number.isFinite(Number(check.fleetScore)) ? Number(check.fleetScore) : undefined,
      failedIssues: Array.isArray(check.failedIssues) ? check.failedIssues : undefined,
      authMode: check.authMode || undefined,
      attentionChecks: Array.isArray(check.attentionChecks) ? check.attentionChecks : undefined,
      attentionCheckCount: Number.isFinite(Number(check.attentionCheckCount))
        ? Number(check.attentionCheckCount)
        : undefined,
      checked: Number.isFinite(Number(check.checked)) ? Number(check.checked) : undefined,
      surfaceFailures: Number.isFinite(Number(check.failed)) ? Number(check.failed) : undefined,
      surfaceWarnings: Number.isFinite(Number(check.warn)) ? Number(check.warn) : undefined,
      reportPath: check.reportPath || undefined,
    }));
}

function summarizeOperationalInputBlockers(report) {
  if (!report || !Array.isArray(report.checks)) return [];
  return report.checks
    .filter((check) => check?.status === 'blocked' || check?.status === 'fail')
    .map((check) => ({
      name: String(check.id || check.name || 'unknown'),
      status: String(check.status || 'unknown'),
      notes: check.notes || check.error || '',
      missing: Array.isArray(check.missing) ? check.missing : undefined,
      alternatives: Array.isArray(check.alternatives) ? check.alternatives : undefined,
    }));
}

function summarizeOperationalInputWarnings(report) {
  if (!report || !Array.isArray(report.checks)) return [];
  return report.checks
    .filter((check) => check?.status === 'warn')
    .map((check) => ({
      name: String(check.id || check.name || 'unknown'),
      status: String(check.status || 'warn'),
      notes: check.notes || check.error || '',
      missing: Array.isArray(check.missing) ? check.missing : undefined,
      alternatives: Array.isArray(check.alternatives) ? check.alternatives : undefined,
    }));
}

function warningLabel(warning) {
  const name = warning.name || warning.source || 'warning';
  const details = [];
  if (Array.isArray(warning.usingDefaults) && warning.usingDefaults.length > 0) {
    details.push(`defaults: ${warning.usingDefaults.join(', ')}`);
  }
  if (Array.isArray(warning.missing) && warning.missing.length > 0) {
    details.push(`missing: ${warning.missing.join(', ')}`);
  }
  return details.length > 0 ? `${name} (${details.join('; ')})` : name;
}

function warningPreview(warnings, limit = 5) {
  const visible = warnings.slice(0, limit).map(warningLabel);
  const remaining = warnings.length - visible.length;
  return remaining > 0 ? `${visible.join(' | ')} | +${remaining} more` : visible.join(' | ');
}

function warningCountForCheck(summary) {
  if (Array.isArray(summary.warningItems) && summary.warningItems.length > 0) {
    return summary.warningItems.length;
  }
  const warningCount = Number(summary.warnings);
  return Number.isFinite(warningCount) && warningCount > 0 ? warningCount : 0;
}

function summaryCount(summary, key) {
  const count = Number(summary?.[key]);
  return Number.isFinite(count) ? count : 0;
}

function spawnWithTimeout(invocation, env, stdoutFd, stderrFd, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let spawnError;
    let forceCloseTimer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (forceCloseTimer) clearTimeout(forceCloseTimer);
      resolve(result);
    };
    const child = spawn(invocation.command, invocation.args, {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', stdoutFd, stderrFd],
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
            error: Object.assign(new Error(`command timed out after ${timeoutMs}ms`), { code: 'ETIMEDOUT' }),
          });
        }, commandTimeoutKillGraceMs);
      }, timeoutMs)
      : null;

    child.on('error', (err) => {
      spawnError = err;
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      finish({
        status: code,
        signal,
        error: timedOut
          ? Object.assign(new Error(`command timed out after ${timeoutMs}ms`), { code: 'ETIMEDOUT' })
          : spawnError,
      });
    });
  });
}

async function runNpmScript(id, script, args = [], envOverride = {}) {
  const startedAt = process.hrtime.bigint();
  if (!jsonOutput) console.error(`[local-release] ${id} running`);
  const invocation = npmRunInvocation(script, args);
  const env = { ...process.env, ...envOverride, FORCE_COLOR: '0' };
  if (script === 'build' && !env.NEXT_BUILD_RECOVERY_WAIT_MS) {
    env.NEXT_BUILD_RECOVERY_WAIT_MS = '60000';
  }

  const stdoutPath = outputPath(id, 'out');
  const stderrPath = outputPath(id, 'err');
  const stdoutFd = openSync(stdoutPath, 'w');
  const stderrFd = openSync(stderrPath, 'w');
  let result;
  try {
    result = await spawnWithTimeout(invocation, env, stdoutFd, stderrFd, commandTimeoutMs);
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
  const timedOut = result?.error?.code === 'ETIMEDOUT';
  if (timedOut) {
    cleanupLingeringScriptProcesses(script);
    sleepSync(750);
    cleanupLingeringScriptProcesses(script);
  }

  return {
    id,
    script,
    command: `npm run ${script}${args.length ? ` ${args.join(' ')}` : ''}`,
    exitCode: result?.status ?? (timedOut ? null : 1),
    signal: result?.signal,
    stdoutPath,
    stderrPath,
    env: envOverride,
    timeoutMs: commandTimeoutMs,
    timedOut,
    error: timedOut
      ? `command timed out after ${commandTimeoutMs}ms`
      : result?.error
        ? result.error.message
        : undefined,
    durationMs: elapsedMs(startedAt),
  };
}

function summarizeSimple(result) {
  const passed = result.exitCode === 0 && !result.timedOut;
  return {
    id: result.id,
    script: result.script,
    command: result.command,
    status: passed ? 'pass' : 'fail',
    exitCode: result.exitCode,
    error: result.error,
    durationMs: result.durationMs,
    timeoutMs: result.timeoutMs,
    timedOut: result.timedOut,
    stdoutTail: passed ? undefined : tailFile(result.stdoutPath),
    stderrTail: passed ? undefined : tailFile(result.stderrPath),
  };
}

function summarizeA11yReport(result) {
  const output = combinedOutput(result);
  const warningCount = (output.match(/\bWarning - /g) || []).length;
  const errorCount = (output.match(/\bError - /g) || []).length;
  const passed = result.exitCode === 0 && errorCount === 0;
  const status = passed ? (warningCount > 0 ? 'warn' : 'pass') : 'fail';
  return {
    id: result.id,
    script: result.script,
    command: result.command,
    status,
    exitCode: result.exitCode,
    error: result.error,
    durationMs: result.durationMs,
    timeoutMs: result.timeoutMs,
    timedOut: result.timedOut,
    warnings: warningCount,
    failed: status === 'fail' ? Math.max(1, errorCount) : 0,
    warningItems: warningCount > 0
      ? [{
        name: 'a11y-report',
        status: 'warn',
        notes: `${warningCount} accessibility warning(s) reported; inspect ${result.stdoutPath} for line-level details.`,
      }]
      : [],
    stdoutTail: status === 'fail' ? tailFile(result.stdoutPath) : undefined,
    stderrTail: status === 'fail' ? tailFile(result.stderrPath) : undefined,
  };
}

function summarizeOpenReadiness(result) {
  const report = parseJsonFromOutput(combinedOutput(result));
  const failed = numericField(report, 'failed');
  const blocked = numericField(report, 'blocked');
  const passed = numericField(report, 'passed');
  const readinessStatus = statusField(report);
  const blockedOnly =
    Boolean(report) &&
    failed === 0 &&
    (blocked > 0 || readinessStatus === 'blocked') &&
    !strictOpenReadiness;
  const readinessPassed =
    Boolean(report) &&
    failed === 0 &&
    ['pass', 'passed', 'ok', 'blocked'].includes(readinessStatus) &&
    (!strictOpenReadiness || blocked === 0);
  const commandExitedCleanly = result.exitCode === 0 || blockedOnly;
  const status = readinessPassed && commandExitedCleanly ? (blockedOnly ? 'blocked' : 'pass') : 'fail';

  return {
    id: result.id,
    script: result.script,
    command: result.command,
    status,
    exitCode: result.exitCode,
    error: result.error,
    durationMs: result.durationMs,
    timeoutMs: result.timeoutMs,
    timedOut: result.timedOut,
    readinessStatus: readinessStatus || 'unknown',
    passed,
    blocked,
    failed,
    blockers: summarizeOpenReadinessBlockers(report),
    strictOpenReadiness,
    stdoutTail: status === 'fail' ? tailFile(result.stdoutPath) : undefined,
    stderrTail: status === 'fail' ? tailFile(result.stderrPath) : undefined,
  };
}

function summarizeAppRouteRuntime(result) {
  const report = parseJsonFromOutput(combinedOutput(result));
  const failed = numericField(report, 'failed');
  const blocked = numericField(report, 'blocked');
  const passed = numericField(report, 'passed');
  const readinessStatus = statusField(report);
  const ok =
    Boolean(report) &&
    result.exitCode === 0 &&
    failed === 0 &&
    ['pass', 'passed', 'ok', 'blocked'].includes(readinessStatus);
  const status = ok ? (blocked > 0 || readinessStatus === 'blocked' ? 'blocked' : 'pass') : 'fail';
  const blockers = Array.isArray(report?.checks)
    ? report.checks
      .filter((check) => check?.status === 'blocked' || check?.status === 'fail')
      .map((check) => ({
        name: String(check.id || check.name || 'unknown'),
        status: String(check.status || 'unknown'),
        notes: check.reason || check.error || '',
        path: check.path || undefined,
        statusCode: Number.isFinite(Number(check.statusCode)) ? Number(check.statusCode) : undefined,
        location: check.location || undefined,
        contentType: check.contentType || undefined,
      }))
    : [];

  return {
    id: result.id,
    script: result.script,
    command: result.command,
    status,
    exitCode: result.exitCode,
    error: result.error,
    durationMs: result.durationMs,
    timeoutMs: result.timeoutMs,
    timedOut: result.timedOut,
    readinessStatus: readinessStatus || 'unknown',
    baseUrl: report?.baseUrl || undefined,
    passed,
    blocked,
    failed,
    blockers,
    stdoutTail: status === 'fail' ? tailFile(result.stdoutPath) : undefined,
    stderrTail: status === 'fail' ? tailFile(result.stderrPath) : undefined,
  };
}

function summarizeReadinessContracts(result) {
  const report = parseJsonFromOutput(combinedOutput(result));
  const failed = numericField(report, 'failed');
  const passed = numericField(report, 'passed');
  const readinessStatus = statusField(report);
  const ok = Boolean(report) && result.exitCode === 0 && readinessStatus === 'pass' && failed === 0;
  const blockers = Array.isArray(report?.checks)
    ? report.checks
      .filter((check) => check?.status === 'fail' || check?.status === 'blocked')
      .map((check) => ({
        name: String(check.id || check.name || 'unknown'),
        status: String(check.status || 'unknown'),
        notes: check.error || check.reportStatus || '',
      }))
    : [];

  return {
    id: result.id,
    script: result.script,
    command: result.command,
    status: ok ? 'pass' : 'fail',
    exitCode: result.exitCode,
    error: result.error,
    durationMs: result.durationMs,
    timeoutMs: result.timeoutMs,
    timedOut: result.timedOut,
    readinessStatus: readinessStatus || 'unknown',
    passed,
    failed,
    blockers,
    stdoutTail: ok ? undefined : tailFile(result.stdoutPath),
    stderrTail: ok ? undefined : tailFile(result.stderrPath),
  };
}

function summarizeOperationalDiscovery(result) {
  const report = parseJsonFromOutput(combinedOutput(result));
  const readinessStatus = statusField(report);
  const missing = Array.isArray(report?.missing) ? report.missing : [];
  const blocked = readinessStatus === 'blocked' || missing.length > 0;
  const ok = Boolean(report) && (result.exitCode === 0 || blocked);
  const status = ok ? (blocked ? 'blocked' : 'pass') : 'fail';
  const blockers = blocked
    ? [{
      name: 'operational-input-discovery',
      status: 'blocked',
      notes: 'Non-secret readiness probe identifiers could not be fully auto-discovered; provide values or Supabase service-role credentials.',
      missing,
      missingConnection: Array.isArray(report?.missingConnection) ? report.missingConnection : undefined,
    }]
    : [];

  return {
    id: result.id,
    script: result.script,
    command: result.command,
    status,
    exitCode: result.exitCode,
    error: result.error,
    durationMs: result.durationMs,
    timeoutMs: result.timeoutMs,
    timedOut: result.timedOut,
    readinessStatus: readinessStatus || 'unknown',
    passed: status === 'pass' ? 1 : 0,
    blocked: status === 'blocked' ? 1 : 0,
    failed: status === 'fail' ? 1 : 0,
    envFilePath: report?.outPath || operationalDiscoveryOutPath,
    loadedEnvFileKeys: Array.isArray(report?.loadedEnvFileKeys) ? report.loadedEnvFileKeys : [],
    missing,
    blockers,
    stdoutTail: status === 'fail' ? tailFile(result.stdoutPath) : undefined,
    stderrTail: status === 'fail' ? tailFile(result.stderrPath) : undefined,
  };
}

function summarizeOperationalInputs(result) {
  const report = parseJsonFromOutput(combinedOutput(result));
  const blocked = numericField(report, 'blocked');
  const warnings = numericField(report, 'warnings');
  const passed = numericField(report, 'passed');
  const failed = numericField(report, 'failed');
  const readinessStatus = statusField(report);
  const ok = Boolean(report) && result.exitCode === 0;
  const status = ok
    ? blocked > 0 || readinessStatus === 'blocked'
      ? 'blocked'
      : warnings > 0 || readinessStatus === 'warn'
        ? 'warn'
        : 'pass'
    : 'fail';

  return {
    id: result.id,
    script: result.script,
    command: result.command,
    status,
    exitCode: result.exitCode,
    error: result.error,
    durationMs: result.durationMs,
    timeoutMs: result.timeoutMs,
    timedOut: result.timedOut,
    readinessStatus: readinessStatus || 'unknown',
    passed,
    blocked,
    failed,
    warnings,
    selfTest: Boolean(report?.selfTest),
    templatePath: operationalInputsTemplatePath,
    actionPlanPath: operationalInputsPlanPath,
    applyScriptPath: operationalInputsApplyScriptPath,
    vercelScriptPath: operationalInputsVercelScriptPath,
    nodeApplyScriptPath: operationalInputsNodeApplyScriptPath,
    nodeVercelScriptPath: operationalInputsNodeVercelScriptPath,
    envFilePath: operationalEnvFilePath || undefined,
    blockers: summarizeOperationalInputBlockers(report),
    warningItems: summarizeOperationalInputWarnings(report),
    stdoutTail: status === 'fail' ? tailFile(result.stdoutPath) : undefined,
    stderrTail: status === 'fail' ? tailFile(result.stderrPath) : undefined,
  };
}

const checks = [];

if (!skipTypeCheck) {
  checks.push({ id: 'type-check', script: 'type-check' });
}

if (!skipLint) {
  checks.push({ id: 'lint', script: 'lint' });
}

if (!skipA11y) {
  checks.push({ id: 'a11y-report', script: 'lint:a11y', interpret: summarizeA11yReport });
}

if (!skipSensitiveApiGuards) {
  checks.push({ id: 'sensitive-api-guards', script: 'audit:sensitive-api-guards' });
}

if (!skipDependencyCircular) {
  checks.push({ id: 'dependency-circular', script: 'check:deps:circular' });
}

if (!skipTests) {
  checks.push({ id: 'unit-tests', script: 'test', args: ['--', '--run'] });
}

if (!skipReadinessContracts) {
  checks.push({
    id: 'readiness-contracts',
    script: 'verify:readiness-contracts',
    args: ['--', '--json'],
    interpret: summarizeReadinessContracts,
  });
}

if (!skipUxMasterplan) {
  checks.push({
    id: 'ux-masterplan',
    script: 'verify:ux-masterplan',
    args: ['--', '--json'],
    interpret: summarizeReadinessContracts,
  });
}

if (autoOperationalDiscovery) {
  checks.push({
    id: 'operational-input-discovery',
    script: 'discover:operational-inputs',
    args: [
      '--',
      '--json',
      `--out=${operationalDiscoveryOutPath}`,
    ],
    interpret: summarizeOperationalDiscovery,
  });
}

if (!skipOperationalInputs) {
  checks.push({
    id: 'operational-inputs',
    script: 'verify:operational-inputs',
    args: [
      '--',
      '--json',
      `--template-out=${operationalInputsTemplatePath}`,
      `--plan-out=${operationalInputsPlanPath}`,
      `--apply-script-out=${operationalInputsApplyScriptPath}`,
      `--vercel-script-out=${operationalInputsVercelScriptPath}`,
      `--node-apply-script-out=${operationalInputsNodeApplyScriptPath}`,
      `--node-vercel-script-out=${operationalInputsNodeVercelScriptPath}`,
      '--inspect-vercel',
      '--inspect-github',
      '--inspect-management-auth',
      '--inspect-supabase-system-secrets',
      ...(operationalInputsEnvFilePath ? [`--env-file=${operationalInputsEnvFilePath}`] : []),
    ],
    interpret: summarizeOperationalInputs,
  });
}

if (!skipMarketingAutomation) {
  checks.push({ id: 'marketing-automation-readiness', script: 'verify:marketing-automation:ci' });
}

if (!skipAppRouteRuntime) {
  checks.push({
    id: 'app-route-runtime',
    script: 'verify:app-route-runtime',
    args: [
      '--',
      '--json',
      `--port=${appRouteRuntimePort}`,
      `--mode=${appRouteRuntimeMode}`,
      `--timeout-ms=${appRouteRuntimeTimeoutMs}`,
      `--ready-timeout-ms=${appRouteRuntimeReadyTimeoutMs}`,
      `--attempts=${appRouteRuntimeAttempts}`,
    ],
    interpret: summarizeAppRouteRuntime,
  });
}

if (!skipOpenReadiness) {
  checks.push({
    id: 'open-readiness-local-full',
    script: 'open:readiness:local:full',
    args: [
      '--',
      `--port=${openPort}`,
      `--mode=${openMode}`,
      `--ready-timeout-ms=${openReadyTimeoutMs}`,
      `--command-timeout-ms=${commandTimeoutMs}`,
      `--timeout-ms=${openTimeoutMs}`,
      `--marketing-runtime-timeout-ms=${marketingRuntimeTimeoutMs}`,
      `--marketing-runtime-ready-timeout-ms=${marketingRuntimeReadyTimeoutMs}`,
      `--marketing-runtime-command-timeout-ms=${commandTimeoutMs}`,
      `--marketing-runtime-hard-timeout-ms=${
        Number.isFinite(marketingRuntimeHardTimeoutMs) && marketingRuntimeHardTimeoutMs > 0
          ? marketingRuntimeHardTimeoutMs
          : Math.max(commandTimeoutMs + 30000, marketingRuntimeReadyTimeoutMs + marketingRuntimeTimeoutMs + 60000, 240000)
      }`,
    ],
    interpret: summarizeOpenReadiness,
  });
}

if (!skipBuild) {
  const buildEnv = { NEXT_DIST_DIR: buildDistDir };
  checks.push({ id: 'production-build', script: 'build', env: buildEnv });
  checks.push({ id: 'bundle-budget', script: 'check:bundle', env: buildEnv });
}

const summaries = [];

for (const check of checks) {
  const result = await runNpmScript(check.id, check.script, check.args || [], check.env || {});
  const summary = check.interpret ? check.interpret(result) : summarizeSimple(result);
  summaries.push(summary);

  if (summary.id === 'operational-input-discovery' && operationalEnvFilePath) {
    operationalEnvFileLoad = loadOperationalEnvFile(operationalEnvFilePath);
  }

  if (!jsonOutput) {
    const suffix =
      summary.status === 'blocked'
        ? `blocked ${summaryCount(summary, 'blocked')}, failed ${summaryCount(summary, 'failed')}`
        : `exit ${summary.exitCode}`;
    const warningCount = warningCountForCheck(summary);
    const warningSuffix = warningCount > 0 ? `, warnings ${warningCount}` : '';
    console.error(`[local-release] ${summary.id} ${summary.status} (${suffix}${warningSuffix}, ${summary.durationMs}ms)`);
    if (summary.status === 'fail') {
      if (summary.stdoutTail) console.error(summary.stdoutTail);
      if (summary.stderrTail) console.error(summary.stderrTail);
      break;
    }
  }

  if (summary.status === 'fail') break;
}

const failed = summaries.filter((check) => check.status === 'fail').length;
const blocked = summaries.filter((check) => check.status === 'blocked').length;
const warned = summaries.filter((check) => check.status === 'warn').length;
const passed = summaries.filter((check) => check.status === 'pass').length;
const releaseBlockers = summaries.flatMap((check) => {
  if (Array.isArray(check.blockers) && check.blockers.length > 0) {
    return check.blockers.map((blocker) => ({
      source: check.id,
      ...blocker,
    }));
  }
  if (check.status === 'blocked' || check.status === 'fail') {
    return [{
      source: check.id,
      name: check.id,
      status: check.status,
      notes: check.error || check.stderrTail || check.stdoutTail || '',
    }];
  }
  return [];
});
const releaseWarnings = summaries.flatMap((check) => {
  if (Array.isArray(check.warningItems) && check.warningItems.length > 0) {
    return check.warningItems.map((warning) => ({
      source: check.id,
      ...warning,
    }));
  }
  const warningCount = Number(check.warnings);
  if (Number.isFinite(warningCount) && warningCount > 0) {
    return [{
      source: check.id,
      name: check.id,
      status: 'warn',
      notes: `${warningCount} warning(s) reported; inspect the check output for details.`,
    }];
  }
  return [];
});
const buildDistCleanup = cleanupBuildDistDir();
if (buildDistCleanup.error) {
  releaseWarnings.push({
    source: 'build-dist-cleanup',
    name: 'build-dist-cleanup',
    status: 'warn',
    notes: buildDistCleanup.error,
    path: buildDistCleanup.path,
  });
}
const status = failed > 0
  ? 'fail'
  : blocked > 0
    ? 'blocked'
    : warned > 0 || releaseWarnings.length > 0
      ? 'warn'
      : 'pass';

const report = {
  status,
  passed,
  blocked,
  warned,
  failed,
  warnings: releaseWarnings.length,
  commandTimeoutMs,
  commandTimeoutKillGraceMs,
  total: summaries.length,
  skipped: {
    typeCheck: skipTypeCheck,
    lint: skipLint,
    a11y: skipA11y,
    sensitiveApiGuards: skipSensitiveApiGuards,
    dependencyCircular: skipDependencyCircular,
    tests: skipTests,
    readinessContracts: skipReadinessContracts,
    uxMasterplan: skipUxMasterplan,
    marketingAutomation: skipMarketingAutomation,
    build: skipBuild,
    openReadiness: skipOpenReadiness,
    appRouteRuntime: skipAppRouteRuntime,
    operationalInputs: skipOperationalInputs,
    operationalDiscovery: !autoOperationalDiscovery,
  },
  buildDistDir: skipBuild ? undefined : buildDistDir,
  buildDistCleanup,
  operationalEnvFile: operationalEnvFileLoad.path
    ? {
      path: operationalEnvFileLoad.path,
      loadedKeys: operationalEnvFileLoad.loadedKeys,
      error: operationalEnvFileLoad.error || undefined,
    }
    : undefined,
  releaseBlockers,
  releaseWarnings,
  checks: summaries,
};

writeReport(reportPath, report);

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.error(
    `[local-release] summary status=${status} strict=${strict} passed=${passed} blocked=${blocked} failed=${failed} warnings=${releaseWarnings.length} total=${summaries.length}`,
  );
  if (releaseWarnings.length > 0) {
    console.error(`[local-release] warnings: ${warningPreview(releaseWarnings)}`);
  }
}

process.exitCode = failed > 0 ? 1 : strict && blocked > 0 ? 2 : 0;
