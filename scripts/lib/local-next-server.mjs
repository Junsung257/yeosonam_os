import { spawn, spawnSync } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

function waitForChildExit(child, timeoutMs = 10000) {
  if (!child || child.exitCode !== null || child.signalCode) return Promise.resolve(true);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off?.('exit', onExit);
      resolve(false);
    }, timeoutMs);

    function onExit() {
      clearTimeout(timer);
      resolve(true);
    }

    child.once('exit', onExit);
  });
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function snapshotFile(path) {
  if (!existsSync(path)) {
    return { path, existed: false, content: null };
  }
  return { path, existed: true, content: readFileSync(path) };
}

function restoreFileSnapshot(snapshot) {
  if (!snapshot?.path) return;
  if (!snapshot.existed) {
    rmSync(snapshot.path, { force: true });
    return;
  }
  writeFileSync(snapshot.path, snapshot.content);
}

function removeOwnedDistDir(server) {
  if (!server?.ownsDistDir || !server.distDir) return;
  const root = resolve(server.root || process.cwd());
  const target = resolve(root, server.distDir);
  const rel = relative(root, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return;
  rmSync(target, { recursive: true, force: true });
}

function lingeringNextDevServerPids(server) {
  if (process.platform === 'win32') return [];
  const root = server.root || process.cwd();
  const result = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      line.includes(root) &&
      (/\bnpm\b.*\brun\b.*\bdev\b/.test(line) || /\bnext\b.*\bdev\b/.test(line) || line.includes('start-server.js'))
    )
    .map((line) => Number(line.split(/\s+/, 1)[0]))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid && pid !== server.child.pid);
}

async function stopLingeringNextDevServers(server) {
  const pids = lingeringNextDevServerPids(server);
  if (pids.length === 0) return;
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Process may already have exited.
    }
  }
  await sleep(500);
  for (const pid of pids) {
    if (!isProcessAlive(pid)) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Best effort cleanup.
    }
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (pids.every((pid) => !isProcessAlive(pid))) return;
    await sleep(250);
  }
}

export async function stopProcessTree(server, { keepServer = false, timeoutMs = 10000 } = {}) {
  if (!server?.child?.pid || keepServer) return;
  server.markStopping();
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(server.child.pid), '/T', '/F'], { stdio: 'ignore' });
      await waitForChildExit(server.child, Math.min(timeoutMs, 1000));
      return;
    }
    try {
      process.kill(-server.child.pid, 'SIGTERM');
    } catch {
      server.child.kill('SIGTERM');
    }
    const stopped = await waitForChildExit(server.child, timeoutMs);
    if (stopped) return;

    try {
      process.kill(-server.child.pid, 'SIGKILL');
    } catch {
      server.child.kill('SIGKILL');
    }
    await waitForChildExit(server.child, 3000);
  } finally {
    await stopLingeringNextDevServers(server);
    server.closeLogs?.();
    restoreFileSnapshot(server.nextEnvSnapshot);
    restoreFileSnapshot(server.tsconfigSnapshot);
    removeOwnedDistDir(server);
  }
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
  const ownsDistDir = mode === 'dev' && !env.NEXT_DIST_DIR;
  if (mode === 'dev' && !env.NEXT_DIST_DIR) {
    env.NEXT_DIST_DIR = `.next-dev-${port}`;
  }
  const tsconfigSnapshot = mode === 'dev'
    ? snapshotFile(resolve(process.cwd(), 'tsconfig.json'))
    : null;
  const nextEnvSnapshot = mode === 'dev'
    ? snapshotFile(resolve(process.cwd(), 'next-env.d.ts'))
    : null;

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
    port,
    root: process.cwd(),
    distDir: env.NEXT_DIST_DIR || '',
    ownsDistDir,
    tsconfigSnapshot,
    nextEnvSnapshot,
    markStopping() {
      expectedStop = true;
    },
    closeLogs() {
      child.stdout.unpipe(out);
      child.stderr.unpipe(err);
      out.end();
      err.end();
    },
  };
}
