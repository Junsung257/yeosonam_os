#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);

function argValue(name, fallback = '') {
  const prefix = `${name}=`;
  const inline = rawArgs.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = rawArgs.indexOf(name);
  return index >= 0 ? rawArgs[index + 1] ?? fallback : fallback;
}

function hasFlag(name) {
  return args.has(name);
}

function positiveNumberArg(name, fallback) {
  const value = Number(argValue(name, fallback));
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`[marketing-runtime-from-vercel] ${name} must be a positive number of milliseconds.`);
    process.exit(1);
  }
  return value;
}

function readEnvFile(path) {
  if (!path || !existsSync(path)) return {};
  return dotenv.parse(readFileSync(path));
}

function mergeNonEmptyEnv(...envs) {
  const merged = {};
  for (const env of envs) {
    for (const [key, value] of Object.entries(env || {})) {
      if (String(value || '').trim()) merged[key] = value;
    }
  }
  return merged;
}

function pickProcessEnv(keys) {
  return Object.fromEntries(
    keys
      .map((key) => [key, process.env[key]])
      .filter(([, value]) => String(value || '').trim()),
  );
}

function missingKeys(env, keys) {
  return keys.filter((key) => !String(env?.[key] || '').trim());
}

function run(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs,
    windowsHide: true,
    env: options.env,
  });
}

function runNpx(commandArgs, options = {}) {
  if (process.platform === 'win32') {
    return run('cmd.exe', ['/d', '/s', '/c', ['npx', ...commandArgs].join(' ')], options);
  }
  return run('npx', commandArgs, options);
}

const json = hasFlag('--json');
const strict = hasFlag('--strict');
const keepTemp = hasFlag('--keep-temp');
const skipDiscovery = hasFlag('--skip-discovery');
const skipContractSelfChecks =
  hasFlag('--skip-contract-self-checks') || process.env.MARKETING_READINESS_SKIP_CONTRACT_SELF_CHECKS === '1';
const environment = argValue('--environment', process.env.MARKETING_RUNTIME_VERCEL_ENV || 'production');
const port = argValue('--port', process.env.MARKETING_RUNTIME_PORT || '3035');
const timeoutMs = argValue('--timeout-ms', process.env.MARKETING_RUNTIME_TIMEOUT_MS || '30000');
const readyTimeoutMs = argValue('--ready-timeout-ms', process.env.MARKETING_RUNTIME_READY_TIMEOUT_MS || '180000');
const commandTimeoutMs = argValue('--command-timeout-ms', process.env.MARKETING_RUNTIME_COMMAND_TIMEOUT_MS || '600000');
const pullTimeoutMs = positiveNumberArg(
  '--pull-timeout-ms',
  process.env.MARKETING_RUNTIME_VERCEL_PULL_TIMEOUT_MS || '120000',
);
const discoveryTimeoutMs = positiveNumberArg(
  '--discovery-timeout-ms',
  process.env.MARKETING_RUNTIME_DISCOVERY_TIMEOUT_MS || '120000',
);
const runtimeTimeoutMs = positiveNumberArg(
  '--hard-timeout-ms',
  process.env.MARKETING_RUNTIME_HARD_TIMEOUT_MS || '900000',
);

const tmpDir = resolve('.tmp');
mkdirSync(tmpDir, { recursive: true });
const tempEnvPath = resolve(tmpDir, `marketing-runtime-vercel-${process.pid}.env`);
const discoveredEnvPath = resolve(tmpDir, `marketing-runtime-operational-${process.pid}.env`);
const operationalEnvFile = argValue('--operational-env-file', process.env.MARKETING_RUNTIME_OPERATIONAL_ENV_FILE || '');
const requiredRuntimeProbeKeys = [
  'MARKETING_CHECK_CARD_NEWS_ID',
  'MARKETING_CHECK_VARIANT_GROUP_ID',
];

let exitCode = 0;
try {
  const pull = runNpx([
    'vercel',
    'env',
    'pull',
    tempEnvPath,
    '--environment',
    environment,
    '--yes',
  ], { timeoutMs: pullTimeoutMs });
  if (pull.status !== 0 || pull.error) {
    console.error('[marketing-runtime-from-vercel] Could not pull Vercel environment variables.');
    if (pull.error) console.error(pull.error.message);
    if (pull.stderr) console.error(pull.stderr.trim());
    exitCode = pull.error?.code === 'ETIMEDOUT' ? 124 : 1;
  } else {
    let operationalEnv = mergeNonEmptyEnv(
      pickProcessEnv(requiredRuntimeProbeKeys),
      operationalEnvFile ? readEnvFile(operationalEnvFile) : {},
    );
    if (!skipDiscovery && missingKeys(operationalEnv, requiredRuntimeProbeKeys).length > 0) {
      const discovery = run(process.execPath, [
        'scripts/discover-operational-readiness-inputs.mjs',
        '--env-file',
        tempEnvPath,
        '--out',
        discoveredEnvPath,
        '--json',
      ], { timeoutMs: discoveryTimeoutMs });
      operationalEnv = mergeNonEmptyEnv(
        readEnvFile(discoveredEnvPath),
        operationalEnv,
      );
      const missingAfterDiscovery = missingKeys(operationalEnv, requiredRuntimeProbeKeys);
      if ((discovery.status !== 0 || discovery.error) && missingAfterDiscovery.length > 0) {
        console.error('[marketing-runtime-from-vercel] Could not discover operational probe identifiers from Vercel env.');
        console.error(`[marketing-runtime-from-vercel] Missing: ${missingAfterDiscovery.join(', ')}`);
        if (discovery.error) console.error(discovery.error.message);
        if (discovery.stderr) console.error(discovery.stderr.trim());
        exitCode = discovery.error?.code === 'ETIMEDOUT' ? 124 : 1;
      }
    }

    if (exitCode === 0) {
      const childEnv = {
        ...process.env,
        ...readEnvFile(tempEnvPath),
        ...operationalEnv,
        MARKETING_READINESS_REQUIRE_DYNAMIC_PROBES: '1',
      };

      const runtimeArgs = [
        'scripts/verify-marketing-runtime-local.mjs',
        '--mode=dev',
        `--port=${port}`,
        `--timeout-ms=${timeoutMs}`,
        `--ready-timeout-ms=${readyTimeoutMs}`,
        `--command-timeout-ms=${commandTimeoutMs}`,
      ];
      if (json) runtimeArgs.push('--json');
      if (strict) runtimeArgs.push('--strict');
      if (skipContractSelfChecks) runtimeArgs.push('--skip-contract-self-checks');

      const runtime = run(process.execPath, runtimeArgs, {
        inherit: true,
        timeoutMs: runtimeTimeoutMs,
        env: childEnv,
      });
      if (runtime.error?.code === 'ETIMEDOUT') {
        console.error(`[marketing-runtime-from-vercel] runtime verification timed out after ${runtimeTimeoutMs}ms.`);
        exitCode = 124;
      } else if (runtime.error) {
        console.error(`[marketing-runtime-from-vercel] runtime verification failed: ${runtime.error.message}`);
        exitCode = 1;
      } else {
        exitCode = runtime.status ?? 1;
      }
    }
  }
} finally {
  if (!keepTemp) {
    rmSync(tempEnvPath, { force: true });
    rmSync(discoveredEnvPath, { force: true });
  }
}

process.exit(exitCode);
