import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

export function validatePort(port, label) {
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    console.error(`[${label}] invalid --port: ${port}`);
    process.exit(1);
  }
}

export function validateMode(mode, label) {
  if (!['dev', 'start'].includes(mode)) {
    console.error(`[${label}] --mode must be dev or start, received: ${mode}`);
    process.exit(1);
  }
}

async function sleep(ms) {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function fetchHealth(baseUrl, healthPath, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${healthPath}`, {
      redirect: 'manual',
      signal: controller.signal,
    });
    return res.status;
  } finally {
    clearTimeout(timeout);
  }
}

export async function waitForReady({
  baseUrl,
  readyTimeoutMs,
  healthPath = '/api/v1/health',
  probeTimeoutMs = 10000,
}) {
  const deadline = Date.now() + readyTimeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const remainingMs = Math.max(1, deadline - Date.now());
      const status = await fetchHealth(baseUrl, healthPath, Math.min(probeTimeoutMs, remainingMs));
      if (status >= 200 && status < 500) return;
      lastError = `status ${status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(1000);
  }
  throw new Error(`server did not become ready within ${readyTimeoutMs}ms (${lastError || 'no response'})`);
}

function serverCommand(script, port) {
  if (process.platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', `npm run ${script} -- -p ${port}`],
    };
  }
  return {
    command: 'npm',
    args: ['run', script, '--', '-p', String(port)],
  };
}

export function stopProcessTree(server, { keepServer = false } = {}) {
  if (!server?.child?.pid || keepServer) return;
  server.markStopping();
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(server.child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-server.child.pid, 'SIGTERM');
    } catch {
      server.child.kill('SIGTERM');
    }
  }
  cleanupDevDistDir(server.devDistDir);
}

function cleanupDevDistDir(devDistDir) {
  if (!devDistDir) return;
  const root = resolve('.');
  const target = resolve(devDistDir);
  const relativeTarget = relative(root, target).replace(/\\/g, '/');
  const firstSegment = relativeTarget.split('/')[0] || '';
  const safe =
    relativeTarget &&
    !relativeTarget.startsWith('../') &&
    !isAbsolute(relativeTarget) &&
    firstSegment.startsWith('.next-dev-');
  if (!safe || !existsSync(target)) return;
  rmSync(target, { recursive: true, force: true });
}

export function startNextServer({
  port,
  mode,
  label,
  logPrefix = label,
}) {
  mkdirSync('.tmp', { recursive: true });
  const outLog = resolve('.tmp', `${logPrefix}-${mode}-${port}.out.log`);
  const errLog = resolve('.tmp', `${logPrefix}-${mode}-${port}.err.log`);
  const out = createWriteStream(outLog, { flags: 'a' });
  const err = createWriteStream(errLog, { flags: 'a' });
  const script = mode === 'dev' ? 'dev' : 'start';
  const { command, args } = serverCommand(script, port);
  let expectedStop = false;
  const env = { ...process.env, FORCE_COLOR: '0' };
  const devDistDir = mode === 'dev' ? env.NEXT_DIST_DIR || `.next-dev-${port}` : '';
  if (mode === 'dev' && !env.NEXT_DIST_DIR) env.NEXT_DIST_DIR = devDistDir;

  const child = spawn(command, args, {
    cwd: process.cwd(),
    detached: process.platform !== 'win32',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(out);
  child.stderr.pipe(err);
  child.on('exit', (code, signal) => {
    if (expectedStop) return;
    if (code !== null && code !== 0) {
      console.error(`[${label}] server exited with ${code}; see ${errLog}`);
    } else if (signal) {
      console.error(`[${label}] server exited by ${signal}; see ${errLog}`);
    }
  });
  return {
    child,
    outLog,
    errLog,
    devDistDir,
    markStopping() {
      expectedStop = true;
    },
  };
}
