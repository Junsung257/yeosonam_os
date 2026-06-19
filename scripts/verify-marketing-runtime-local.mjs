#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  startNextServer,
  stopProcessTree,
  validateMode,
  validatePort,
  waitForReady,
} from './lib/local-next-server.mjs';

const rawArgs = process.argv.slice(2);

function argValue(name, fallback = '') {
  const prefix = `${name}=`;
  const inline = rawArgs.findLast((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = rawArgs.lastIndexOf(name);
  return index >= 0 ? rawArgs[index + 1] ?? fallback : fallback;
}

function hasFlag(name) {
  return rawArgs.includes(name);
}

const port = Number(argValue('--port', process.env.MARKETING_RUNTIME_PORT || '3033'));
const mode = argValue('--mode', process.env.MARKETING_RUNTIME_MODE || 'dev');
const timeoutMs = Number(argValue('--timeout-ms', process.env.MARKETING_RUNTIME_TIMEOUT_MS || '60000'));
const readyTimeoutMs = Number(argValue('--ready-timeout-ms', process.env.MARKETING_RUNTIME_READY_TIMEOUT_MS || '90000'));
const commandTimeoutMs = Number(argValue('--command-timeout-ms', process.env.MARKETING_RUNTIME_COMMAND_TIMEOUT_MS || '180000'));
const keepServer = hasFlag('--keep-server');
const strict = hasFlag('--strict') || process.env.MARKETING_RUNTIME_STRICT === '1';
const skipContractSelfChecks =
  hasFlag('--skip-contract-self-checks') || process.env.MARKETING_READINESS_SKIP_CONTRACT_SELF_CHECKS === '1';
const explicitBase = argValue('--base', process.env.MARKETING_RUNTIME_BASE_URL || '').replace(/\/$/, '');
const baseUrl = explicitBase || `http://127.0.0.1:${port}`;
const shouldStartServer = !explicitBase;
const runtimeDistDir = process.env.NEXT_DIST_DIR || '.next';

validatePort(port, 'marketing-runtime-local');
validateMode(mode, 'marketing-runtime-local');

if (!Number.isFinite(commandTimeoutMs) || commandTimeoutMs <= 0) {
  console.error('[marketing-runtime-local] --command-timeout-ms must be a positive number of milliseconds.');
  process.exit(1);
}

if (shouldStartServer && mode === 'start' && !existsSync(`${runtimeDistDir}/BUILD_ID`)) {
  console.error(`[marketing-runtime-local] start mode requires a production build in ${runtimeDistDir}. Run npm run build first.`);
  process.exit(1);
}

function runReadiness() {
  const args = [
    'scripts/verify-marketing-automation-readiness.mjs',
    `--base=${baseUrl}`,
    `--timeout-ms=${timeoutMs}`,
    '--json',
  ];
  if (strict) args.push('--strict');
  if (skipContractSelfChecks) args.push('--skip-contract-self-checks');
  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...(mode === 'start' && !process.env.MARKETING_READINESS_ALLOW_MISSING_ADMIN_COOKIE
        ? { MARKETING_READINESS_ALLOW_MISSING_ADMIN_COOKIE: '1' }
        : {}),
    },
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
      label: 'marketing-runtime-local',
      logPrefix: 'marketing-runtime',
    });
    console.error(`[marketing-runtime-local] starting ${mode} server on ${baseUrl}`);
    console.error(`[marketing-runtime-local] logs: ${server.outLog}`);
    await waitForReady({ baseUrl, readyTimeoutMs });
  } else {
    console.error(`[marketing-runtime-local] using existing server at ${baseUrl}`);
  }

  const result = runReadiness();
  if (result.error?.code === 'ETIMEDOUT') {
    console.error(`[marketing-runtime-local] marketing readiness command timed out after ${commandTimeoutMs}ms.`);
    process.exitCode = 1;
  } else if (result.error) {
    console.error(`[marketing-runtime-local] marketing readiness command failed: ${result.error.message}`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
} catch (err) {
  console.error(`[marketing-runtime-local] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  if (server) stopProcessTree(server, { keepServer });
}
