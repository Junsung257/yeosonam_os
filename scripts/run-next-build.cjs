/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.cwd();
const distDirName = process.env.NEXT_DIST_DIR || '.next';
const distDir = path.resolve(root, distDirName);
const lockPath = path.join(root, '.next-build.lock');

function assertInsideWorkspace(target) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clean unsafe Next distDir: ${target}`);
  }
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

function acquireLock() {
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2));
    fs.closeSync(fd);
    return;
  } catch (err) {
    if (err?.code !== 'EEXIST') throw err;
  }

  let existing = null;
  try {
    existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    existing = null;
  }

  if (isProcessAlive(existing?.pid)) {
    throw new Error(`Another Next build is already running in this workspace (pid ${existing.pid}).`);
  }

  fs.rmSync(lockPath, { force: true });
  acquireLock();
}

function releaseLock() {
  try {
    const existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (existing?.pid === process.pid) fs.rmSync(lockPath, { force: true });
  } catch {
    // best effort
  }
}

function appendNodeOption(current, option) {
  if (current?.includes('--max_old_space_size') || current?.includes('--max-old-space-size')) return current;
  return current ? `${current} ${option}` : option;
}

function cleanDistDir() {
  if (process.env.NEXT_BUILD_CLEAN === '0') return;
  assertInsideWorkspace(distDir);
  fs.rmSync(distDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 300,
  });
}

function runBuild() {
  const nextBin = require.resolve('next/dist/bin/next');
  const env = {
    ...process.env,
    NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS || '', '--max_old_space_size=6144'),
  };
  const result = spawnSync(process.execPath, [nextBin, 'build', ...process.argv.slice(2)], {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

process.on('exit', releaseLock);
process.on('SIGINT', () => {
  releaseLock();
  process.exit(130);
});
process.on('SIGTERM', () => {
  releaseLock();
  process.exit(143);
});

try {
  acquireLock();
  cleanDistDir();
  require('./ensure-next-routes-js-shim.cjs');
  runBuild();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
