#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  startNextServer,
  stopProcessTree,
  validateMode,
  validatePort,
  waitForReady,
} from './lib/local-next-server.mjs';

const rawArgs = process.argv.slice(2);
const WRAPPER_OPTIONS = new Set(['--port', '--mode', '--ready-timeout-ms', '--command-timeout-ms', '--keep-server']);

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

function openReadinessArgs() {
  const out = [
    '--local',
    '--skip-external',
    '--allow-local-missing-data',
    '--include-marketing-runtime',
    '--json',
    `--base=${baseUrl}`,
  ];

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    const option = arg.includes('=') ? arg.split('=')[0] : arg;
    if (WRAPPER_OPTIONS.has(option)) {
      if (!arg.includes('=') && option !== '--keep-server') i += 1;
      continue;
    }
    if (option === '--base') {
      if (!arg.includes('=')) i += 1;
      continue;
    }
    out.push(arg);
  }

  return out;
}

const port = Number(argValue('--port', process.env.OPEN_READINESS_LOCAL_PORT || '3040'));
const mode = argValue('--mode', process.env.OPEN_READINESS_LOCAL_MODE || 'dev');
const readyTimeoutMs = Number(argValue('--ready-timeout-ms', process.env.OPEN_READINESS_LOCAL_READY_TIMEOUT_MS || '120000'));
const commandTimeoutMs = Number(argValue('--command-timeout-ms', process.env.OPEN_READINESS_LOCAL_COMMAND_TIMEOUT_MS || '300000'));
const keepServer = hasFlag('--keep-server');
const explicitBase = argValue('--base', process.env.OPEN_READINESS_LOCAL_BASE_URL || '').replace(/\/$/, '');
const baseUrl = explicitBase || `http://127.0.0.1:${port}`;
const shouldStartServer = !explicitBase;

validatePort(port, 'open-readiness-local');
validateMode(mode, 'open-readiness-local');

if (!Number.isFinite(commandTimeoutMs) || commandTimeoutMs <= 0) {
  console.error('[open-readiness-local] --command-timeout-ms must be a positive number of milliseconds.');
  process.exit(1);
}

function runOpenReadiness() {
  return spawnSync(process.execPath, ['scripts/open-readiness-check.mjs', ...openReadinessArgs()], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    timeout: commandTimeoutMs,
  });
}

let server = null;

try {
  if (shouldStartServer) {
    server = startNextServer({
      port,
      mode,
      label: 'open-readiness-local',
      logPrefix: 'open-readiness-local',
    });
    console.error(`[open-readiness-local] starting ${mode} server on ${baseUrl}`);
    console.error(`[open-readiness-local] logs: ${server.outLog}`);
    await waitForReady({ baseUrl, readyTimeoutMs });
  } else {
    console.error(`[open-readiness-local] using existing server at ${baseUrl}`);
  }

  const result = runOpenReadiness();
  if (result.error?.code === 'ETIMEDOUT') {
    console.error(`[open-readiness-local] open readiness command timed out after ${commandTimeoutMs}ms.`);
    process.exitCode = 1;
  } else if (result.error) {
    console.error(`[open-readiness-local] open readiness command failed: ${result.error.message}`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
} catch (err) {
  console.error(`[open-readiness-local] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  if (server) stopProcessTree(server, { keepServer });
}
