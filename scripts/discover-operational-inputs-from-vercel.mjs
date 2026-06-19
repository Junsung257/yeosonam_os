#!/usr/bin/env node

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const rawArgs = process.argv.slice(2);
const json = rawArgs.includes('--json');

function argValue(name, fallback = '') {
  const prefix = `${name}=`;
  const inline = rawArgs.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = rawArgs.indexOf(name);
  return index >= 0 ? rawArgs[index + 1] ?? fallback : fallback;
}

function fail(message, details = {}) {
  if (json) console.log(JSON.stringify({ status: 'fail', error: message, ...details }, null, 2));
  else console.error(message);
  process.exit(1);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    ...options,
  });
}

function runVercelEnvPull(path) {
  const commandArgs = ['vercel', 'env', 'pull', path, '--yes', `--environment=${environment}`];
  if (process.platform === 'win32') {
    return run('cmd.exe', [
      '/d',
      '/s',
      '/c',
      `npx vercel env pull ${path} --yes --environment=${environment}`,
    ], {
      timeout: pullTimeoutMs,
    });
  }
  return run('npx', commandArgs, { timeout: pullTimeoutMs });
}

const environment = argValue('--environment', process.env.OPERATIONAL_DISCOVERY_VERCEL_ENV || 'production');
const outPath = argValue('--out', '.tmp/operational-readiness-discovered-from-vercel.env');
const timeoutMs = argValue('--timeout-ms', process.env.OPERATIONAL_DISCOVERY_TIMEOUT_MS || '10000');
const pullTimeoutMs = Number(argValue(
  '--pull-timeout-ms',
  process.env.OPERATIONAL_DISCOVERY_VERCEL_PULL_TIMEOUT_MS || '30000',
));
const tempEnvPath = join('.tmp', `operational-vercel-env-${process.pid}.env`);

if (!Number.isFinite(pullTimeoutMs) || pullTimeoutMs <= 0) {
  fail('--pull-timeout-ms must be a positive number of milliseconds.');
}

try {
  const pull = runVercelEnvPull(tempEnvPath);
  if (pull.status !== 0 || pull.error) {
    fail('Could not pull Vercel environment variables.', {
      environment,
      timedOut: pull.error?.code === 'ETIMEDOUT',
      detail: String(pull.stderr || pull.stdout || pull.error?.message || 'unknown error').trim().slice(0, 500),
    });
  }

  const discoverArgs = [
    'scripts/discover-operational-readiness-inputs.mjs',
    `--env-file=${tempEnvPath}`,
    `--out=${outPath}`,
    `--timeout-ms=${timeoutMs}`,
  ];
  if (json) discoverArgs.push('--json');
  const discovery = run(process.execPath, discoverArgs);
  if (discovery.stdout) process.stdout.write(discovery.stdout);
  if (discovery.stderr) process.stderr.write(discovery.stderr);
  process.exitCode = discovery.status || 0;
} finally {
  rmSync(tempEnvPath, { force: true });
}
