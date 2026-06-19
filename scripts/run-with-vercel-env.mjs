import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import dotenv from 'dotenv';

const rawArgs = process.argv.slice(2);
const wrapperOptions = new Set([
  '--environment',
  '--env',
  '--pull-timeout-ms',
  '--command-timeout-ms',
]);

function argValue(sourceArgs, name, fallback = '') {
  let value = fallback;
  for (let index = 0; index < sourceArgs.length; index += 1) {
    const arg = sourceArgs[index];
    if (arg === name && sourceArgs[index + 1] !== undefined) value = sourceArgs[index + 1];
    if (arg.startsWith(`${name}=`)) value = arg.slice(name.length + 1);
  }
  return value;
}

function argKey(arg) {
  return String(arg || '').split('=')[0];
}

function quoteForShell(value) {
  if (process.platform !== 'win32') {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
  }

  const stringValue = String(value);
  if (/^[A-Za-z0-9_./:=+\\-]+$/.test(stringValue)) {
    return stringValue;
  }

  return `"${stringValue.replace(/"/g, '""')}"`;
}

function run(commandArgs, options = {}) {
  const startedAt = Date.now();
  if (process.platform === 'win32') {
    const result = spawnSync('cmd.exe', ['/d', '/s', '/c', commandArgs.map(quoteForShell).join(' ')], {
      ...options,
      shell: false,
    });
    return {
      ...result,
      timedOut: result.error?.code === 'ETIMEDOUT',
      durationMs: Date.now() - startedAt,
    };
  }

  const [command, ...args] = commandArgs;
  const result = spawnSync(command, args, {
    ...options,
    shell: false,
  });
  return {
    ...result,
    timedOut: result.error?.code === 'ETIMEDOUT',
    durationMs: Date.now() - startedAt,
  };
}

const args = rawArgs;
let separatorIndex = args.indexOf('--');

if (separatorIndex === -1) {
  separatorIndex = args.findIndex((arg) => !arg.startsWith('--'));
}

const wrapperArgs = separatorIndex === -1
  ? args
  : args.slice(0, separatorIndex);
const unknownWrapperArgs = wrapperArgs.filter((arg, index) => {
  if (index > 0 && wrapperOptions.has(wrapperArgs[index - 1])) return false;
  return arg.startsWith('--') && !wrapperOptions.has(argKey(arg));
});

if (unknownWrapperArgs.length > 0) {
  for (const arg of unknownWrapperArgs) {
    console.error(`[vercel-env] Unknown wrapper argument: ${arg}`);
  }
  process.exit(1);
}

let environment = 'production';
for (let i = 0; i < wrapperArgs.length; i += 1) {
  const arg = wrapperArgs[i];

  if (arg === '--environment' || arg === '--env') {
    environment = wrapperArgs[i + 1] || environment;
    i += 1;
    continue;
  }

  if (arg.startsWith('--environment=')) {
    environment = arg.split('=')[1] || environment;
    continue;
  }

  if (arg.startsWith('--env=')) {
    environment = arg.split('=')[1] || environment;
  }
}

const pullTimeoutMs = Number(argValue(wrapperArgs, '--pull-timeout-ms', process.env.VERCEL_ENV_PULL_TIMEOUT_MS || '120000'));
const commandTimeoutMs = Number(argValue(wrapperArgs, '--command-timeout-ms', process.env.VERCEL_ENV_COMMAND_TIMEOUT_MS || '900000'));

if (!Number.isFinite(pullTimeoutMs) || pullTimeoutMs <= 0) {
  console.error('[vercel-env] --pull-timeout-ms must be a positive number of milliseconds.');
  process.exit(1);
}
if (!Number.isFinite(commandTimeoutMs) || commandTimeoutMs <= 0) {
  console.error('[vercel-env] --command-timeout-ms must be a positive number of milliseconds.');
  process.exit(1);
}

const commandArgs = separatorIndex === -1 ? [] : args.slice(separatorIndex + (args[separatorIndex] === '--' ? 1 : 0));

if (commandArgs.length === 0) {
  console.error('Usage: node scripts/run-with-vercel-env.mjs --environment=production -- <command> [args...]');
  process.exit(1);
}

const tmpDir = mkdtempSync(join(tmpdir(), 'yeosonam-vercel-env-'));
const envPath = join(tmpDir, `${environment}.env`);
let exitCode = 0;

try {
  const pull = run(['vercel', 'env', 'pull', envPath, '--environment', environment, '--yes'], {
    encoding: 'utf8',
    stdio: ['ignore', 'inherit', 'inherit'],
    timeout: pullTimeoutMs,
  });

  if (pull.timedOut) {
    console.error(`[vercel-env] Vercel env pull timed out after ${pullTimeoutMs}ms.`);
    exitCode = 1;
  } else if (pull.error) {
    console.error(`[vercel-env] Failed to pull Vercel env: ${pull.error.message}`);
    exitCode = 1;
  }

  if (exitCode === 0 && pull.status !== 0) {
    exitCode = pull.status ?? 1;
  }

  if (exitCode === 0) {
    const parsed = dotenv.parse(readFileSync(envPath, 'utf8'));
    rmSync(envPath, { force: true });
    const childEnv = { ...process.env, ...parsed };
    console.log(`[vercel-env] Loaded ${Object.keys(parsed).length} ${environment} variables for child process.`);

    const child = run(commandArgs, {
      env: childEnv,
      stdio: 'inherit',
      timeout: commandTimeoutMs,
    });

    if (child.timedOut) {
      console.error(`[vercel-env] Child command timed out after ${commandTimeoutMs}ms.`);
      exitCode = 1;
    } else if (child.error) {
      console.error(`[vercel-env] Failed to run child command: ${child.error.message}`);
      exitCode = 1;
    } else {
      exitCode = child.status ?? 1;
    }
  }
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

process.exit(exitCode);
