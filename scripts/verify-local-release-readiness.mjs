#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
const skipTests = hasFlag('--skip-tests');
const skipBuild = hasFlag('--skip-build');
const skipOpenReadiness = hasFlag('--skip-open-readiness');
const strictOpenReadiness = hasFlag('--strict-open');

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

function npmRunInvocation(script, args) {
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

function runNpmScript(id, script, args = []) {
  const startedAt = process.hrtime.bigint();
  if (!jsonOutput) console.error(`[local-release] ${id} running`);
  const invocation = npmRunInvocation(script, args);
  const env = { ...process.env, FORCE_COLOR: '0' };
  if (script === 'build' && !env.NEXT_BUILD_RECOVERY_WAIT_MS) {
    env.NEXT_BUILD_RECOVERY_WAIT_MS = '60000';
  }

  const stdoutPath = outputPath(id, 'out');
  const stderrPath = outputPath(id, 'err');
  const stdoutFd = openSync(stdoutPath, 'w');
  const stderrFd = openSync(stderrPath, 'w');
  let result;
  try {
    result = spawnSync(invocation.command, invocation.args, {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', stdoutFd, stderrFd],
      windowsHide: true,
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }

  return {
    id,
    script,
    command: `npm run ${script}${args.length ? ` ${args.join(' ')}` : ''}`,
    exitCode: result?.status ?? 1,
    signal: result?.signal,
    stdoutPath,
    stderrPath,
    error: result?.error ? result.error.message : undefined,
    durationMs: elapsedMs(startedAt),
  };
}

function summarizeSimple(result) {
  const passed = result.exitCode === 0;
  return {
    id: result.id,
    script: result.script,
    command: result.command,
    status: passed ? 'pass' : 'fail',
    exitCode: result.exitCode,
    error: result.error,
    durationMs: result.durationMs,
    stdoutTail: passed ? undefined : tailFile(result.stdoutPath),
    stderrTail: passed ? undefined : tailFile(result.stderrPath),
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
    readinessStatus: readinessStatus || 'unknown',
    passed,
    blocked,
    failed,
    strictOpenReadiness,
    stdoutTail: status === 'fail' ? tailFile(result.stdoutPath) : undefined,
    stderrTail: status === 'fail' ? tailFile(result.stderrPath) : undefined,
  };
}

const checks = [
  { id: 'type-check', script: 'type-check' },
  { id: 'lint', script: 'lint' },
];

if (!skipTests) {
  checks.push({ id: 'unit-tests', script: 'test', args: ['--', '--run'] });
}

checks.push({ id: 'marketing-automation-readiness', script: 'verify:marketing-automation:ci' });

if (!skipOpenReadiness) {
  checks.push({
    id: 'open-readiness-local-full',
    script: 'open:readiness:local:full',
    args: [
      '--',
      `--port=${openPort}`,
      `--mode=${openMode}`,
      `--ready-timeout-ms=${openReadyTimeoutMs}`,
      `--timeout-ms=${openTimeoutMs}`,
      `--marketing-runtime-timeout-ms=${marketingRuntimeTimeoutMs}`,
      `--marketing-runtime-ready-timeout-ms=${marketingRuntimeReadyTimeoutMs}`,
    ],
    interpret: summarizeOpenReadiness,
  });
}

if (!skipBuild) {
  checks.push({ id: 'production-build', script: 'build' });
  checks.push({ id: 'bundle-budget', script: 'check:bundle' });
}

const summaries = [];

for (const check of checks) {
  const result = runNpmScript(check.id, check.script, check.args || []);
  const summary = check.interpret ? check.interpret(result) : summarizeSimple(result);
  summaries.push(summary);

  if (!jsonOutput) {
    const suffix =
      summary.status === 'blocked'
        ? `blocked ${summary.blocked}, failed ${summary.failed}`
        : `exit ${summary.exitCode}`;
    console.error(`[local-release] ${summary.id} ${summary.status} (${suffix}, ${summary.durationMs}ms)`);
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
const passed = summaries.filter((check) => check.status === 'pass').length;
const status = failed > 0 ? 'fail' : blocked > 0 ? 'blocked' : 'pass';

const report = {
  status,
  passed,
  blocked,
  failed,
  total: summaries.length,
  skipped: {
    tests: skipTests,
    build: skipBuild,
    openReadiness: skipOpenReadiness,
  },
  checks: summaries,
};

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.error(
    `[local-release] summary status=${status} passed=${passed} blocked=${blocked} failed=${failed} total=${summaries.length}`,
  );
}

process.exitCode = failed > 0 ? 1 : 0;
