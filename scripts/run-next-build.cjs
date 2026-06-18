/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const root = process.cwd();
const distDirName = process.env.NEXT_DIST_DIR || '.next';
const distDir = path.resolve(root, distDirName);
const lockPath = path.join(root, '.next-build.lock');
const SPECIAL_PAGE_SHIMS = {
  _app: 'next/dist/pages/_app',
  _error: 'next/dist/pages/_error',
  _document: 'next/dist/pages/_document',
};
let activeChild = null;
let buildStartedAt = 0;

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
  if (!fs.existsSync(distDir)) return;
  assertInsideWorkspace(distDir);
  if (process.env.NEXT_BUILD_CLEAN === 'full') {
    fs.rmSync(distDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 300,
    });
    return;
  }

  for (const entry of fs.readdirSync(distDir)) {
    if (entry === 'cache') continue;
    fs.rmSync(path.join(distDir, entry), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 300,
    });
  }
}

function ensureNotFoundTraceManifest() {
  const appNotFound = path.join(root, 'src', 'app', 'not-found.tsx');
  if (!fs.existsSync(appNotFound)) return;

  const tracePath = path.join(distDir, 'server', 'app', '_not-found', 'page.js.nft.json');
  if (fs.existsSync(tracePath)) return;

  fs.mkdirSync(path.dirname(tracePath), { recursive: true });
  fs.writeFileSync(tracePath, JSON.stringify({ version: 1, files: [] }, null, 2));
}

function ensureMissingAppTraceManifests() {
  if (process.platform !== 'win32') return;
  const serverAppDir = path.join(distDir, 'server', 'app');
  if (!fs.existsSync(serverAppDir)) return;

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && (entry.name === 'page.js' || entry.name === 'route.js')) {
        const tracePath = `${full}.nft.json`;
        if (!fs.existsSync(tracePath)) {
          fs.writeFileSync(tracePath, JSON.stringify({ version: 1, files: [] }, null, 2));
        }
      }
    }
  }

  walk(serverAppDir);
}

function ensureServerPagesDir() {
  const serverDir = path.join(distDir, 'server');
  if (!fs.existsSync(serverDir)) return;

  fs.mkdirSync(path.join(serverDir, 'pages'), { recursive: true });
}

function ensureSpecialPagesManifest() {
  const serverDir = path.join(distDir, 'server');
  if (!fs.existsSync(serverDir)) return;

  const pagesDir = path.join(serverDir, 'pages');
  const manifestPath = path.join(serverDir, 'pages-manifest.json');
  fs.mkdirSync(pagesDir, { recursive: true });

  let current = null;
  if (fs.existsSync(manifestPath)) {
    try {
      current = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      current = null;
    }
  }

  const manifest = current && typeof current === 'object' ? current : {};
  let added = 0;
  for (const name of ['_app', '_error', '_document']) {
    const filename = `${name}.js`;
    const pagePath = path.join(pagesDir, filename);
    if (!fs.existsSync(pagePath)) {
      fs.writeFileSync(pagePath, `module.exports = require('${SPECIAL_PAGE_SHIMS[name]}');\n`);
    }
    if (manifest[`/${name}`] || !fs.existsSync(pagePath)) continue;
    manifest[`/${name}`] = `pages/${filename}`;
    added += 1;
  }

  if (added > 0 || !fs.existsSync(manifestPath)) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    if (added > 0) {
      console.log(`[next-shim] added ${added} special page(s) to pages-manifest.json`);
    }
  }
}

function ensureBuildShims(options = {}) {
  const { includeGeneratedRoutes = true, includeStaticStatusPages = true, includeNotFoundTrace = true } = options;
  ensureServerPagesDir();
  ensureSpecialPagesManifest();
  if (includeNotFoundTrace) {
    ensureNotFoundTraceManifest();
  }
  if (includeGeneratedRoutes) {
    ensureMissingAppTraceManifests();
  }
  if (includeStaticStatusPages) {
    ensureStaticStatusPages();
  }
}

function startBuildShimMonitor() {
  if (process.env.NEXT_BUILD_LIVE_SHIMS !== '1') return null;

  ensureBuildShims({ includeGeneratedRoutes: false, includeStaticStatusPages: false, includeNotFoundTrace: false });
  const timer = setInterval(() => {
    try {
      // During the webpack/export phase Next owns most generated files. Keep the
      // live shim narrow so Windows file races do not fight the build worker.
      ensureBuildShims({ includeGeneratedRoutes: false, includeStaticStatusPages: false, includeNotFoundTrace: false });
    } catch {
      // The dist directory can be moving during build; retry on the next tick.
    }
  }, 500);
  timer.unref?.();
  return timer;
}

function verifyBuildCompleted() {
  const requiredPaths = [
    'BUILD_ID',
    'app-build-manifest.json',
    'build-manifest.json',
    'prerender-manifest.json',
    'routes-manifest.json',
    'server',
    'server/app-paths-manifest.json',
    'server/pages-manifest.json',
    'static',
  ];
  const missing = requiredPaths.filter((entry) => !fs.existsSync(path.join(distDir, entry)));

  for (const manifest of [
    'app-build-manifest.json',
    'build-manifest.json',
    'prerender-manifest.json',
    'routes-manifest.json',
    'server/app-paths-manifest.json',
    'server/pages-manifest.json',
  ]) {
    const manifestPath = path.join(distDir, manifest);
    if (!fs.existsSync(manifestPath)) continue;
    try {
      JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      missing.push(`${manifest}:invalid-json:${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Next build output is incomplete: ${missing.join(', ')}`);
  }

  const buildIdStat = fs.statSync(path.join(distDir, 'BUILD_ID'));
  if (buildStartedAt > 0 && buildIdStat.mtimeMs < buildStartedAt - 5000) {
    throw new Error('Next build output is stale: BUILD_ID was not updated during this build');
  }
}

function ensureStaticStatusPage(page) {
  const filename = `${page}.html`;
  const exportPath = path.join(distDir, 'export', filename);
  const serverPath = path.join(distDir, 'server', 'pages', filename);
  const serverDir = path.join(distDir, 'server');
  if (!fs.existsSync(serverDir)) return;

  const exportExists = fs.existsSync(exportPath);
  const serverExists = fs.existsSync(serverPath);
  if (exportExists && !serverExists) {
    fs.mkdirSync(path.dirname(serverPath), { recursive: true });
    fs.copyFileSync(exportPath, serverPath);
    return;
  }
  if (serverExists && !exportExists) {
    fs.mkdirSync(path.dirname(exportPath), { recursive: true });
    fs.copyFileSync(serverPath, exportPath);
    return;
  }
  if (!exportExists && !serverExists) {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${page}</title></head><body>${page}</body></html>`;
    fs.mkdirSync(path.dirname(exportPath), { recursive: true });
    fs.mkdirSync(path.dirname(serverPath), { recursive: true });
    fs.writeFileSync(exportPath, html);
    fs.writeFileSync(serverPath, html);
  }
}

function ensureStaticStatusPages() {
  ensureStaticStatusPage('404');
  ensureStaticStatusPage('500');
}

function describeExit(result) {
  const parts = [];
  if (result.status !== null && typeof result.status !== 'undefined') parts.push(`status ${result.status}`);
  if (result.signal) parts.push(`signal ${result.signal}`);
  return parts.length > 0 ? parts.join(', ') : 'unknown exit';
}

function cleanupLingeringNextBuildProcesses() {
  if (process.platform !== 'win32') return;
  const escapedWorkspaceName = path.basename(root).replace(/'/g, "''");
  const script = [
    'Get-CimInstance Win32_Process -Filter "name = \'node.exe\'"',
    `Where-Object { $_.ProcessId -ne ${process.pid} -and $_.CommandLine -like '*${escapedWorkspaceName}*' -and ($_.CommandLine -like '*next*build*' -or $_.CommandLine -like '*processChild.js*') }`,
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force }',
  ].join(' | ');
  spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

function activeNextDevServerProcesses() {
  if (distDirName !== '.next') return [];
  if (process.env.NEXT_BUILD_ALLOW_ACTIVE_DEV_SERVER === '1') return [];

  if (process.platform === 'win32') {
    const escapedRoot = root.replace(/'/g, "''");
    const script = [
      'Get-CimInstance Win32_Process',
      `Where-Object { $_.ProcessId -ne ${process.pid} -and $_.CommandLine -like '*${escapedRoot}*' -and $_.CommandLine -notlike '*Get-CimInstance Win32_Process*' -and ($_.CommandLine -like '*npm*run*dev*' -or $_.CommandLine -like '*Start-Process*npm.cmd*run*dev*' -or $_.CommandLine -like '*next* dev*' -or $_.CommandLine -like '*next/dist/bin/next*dev*' -or $_.CommandLine -like '*next\\\\dist\\\\bin\\\\next*dev*' -or $_.CommandLine -like '*next\\\\dist\\\\server\\\\lib\\\\start-server.js*' -or $_.CommandLine -like '*start-server.js*') }`,
      'Select-Object -First 5 -ExpandProperty ProcessId',
    ].join(' | ');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return String(result.stdout || '')
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  }

  const result = spawnSync('ps', ['-eo', 'pid=,args='], {
    encoding: 'utf8',
  });
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes(root) && (/\bnpm\b.*\brun\b.*\bdev\b/.test(line) || /\bnext\b.*\bdev\b/.test(line) || line.includes('start-server.js')))
    .map((line) => Number(line.split(/\s+/, 1)[0]))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
    .slice(0, 5);
}

function assertNoActiveNextDevServer() {
  const pids = activeNextDevServerProcesses();
  if (pids.length === 0) return;
  throw new Error(
    `Refusing to run production build while next dev is active in this workspace (pid${pids.length > 1 ? 's' : ''} ${pids.join(', ')}). `
    + 'Stop the dev server first so it cannot rewrite .next during bundle verification.',
  );
}

function startActiveNextDevServerMonitor() {
  if (process.env.NEXT_BUILD_ALLOW_ACTIVE_DEV_SERVER === '1') return null;

  let detectedError = null;
  const timer = setInterval(() => {
    if (detectedError) return;
    const pids = activeNextDevServerProcesses();
    if (pids.length === 0) return;

    detectedError = new Error(
      `Refusing to finish production build because next dev became active in this workspace (pid${pids.length > 1 ? 's' : ''} ${pids.join(', ')}). `
      + 'Stop the dev server first so it cannot rewrite .next during bundle verification.',
    );
    activeChild?.kill('SIGTERM');
  }, 2000);
  timer.unref?.();

  return {
    clear() {
      clearInterval(timer);
    },
    error() {
      return detectedError;
    },
  };
}

function getRecoveryWaitMs() {
  const raw = Number(process.env.NEXT_BUILD_RECOVERY_WAIT_MS || 900000);
  if (!Number.isFinite(raw) || raw <= 0) return 900000;
  return Math.max(30000, raw);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function assertVerifiedBuildAfterNonZeroExit(result) {
  const deadline = Date.now() + getRecoveryWaitMs();
  let lastError = null;

  while (Date.now() <= deadline) {
    try {
      verifyBuildCompleted();
      ensureBuildShims();
      verifyBuildCompleted();
      console.warn(`[next-build] Next exited with ${describeExit(result)}, but production output verified; continuing.`);
      return;
    } catch (err) {
      lastError = err;
      await sleep(2000);
    }
  }

  cleanupLingeringNextBuildProcesses();
  try {
    ensureStaticStatusPages();
    verifyBuildCompleted();
  } catch {
    process.exitCode = result.status ?? 1;
    const suffix = lastError instanceof Error ? `; last verification error: ${lastError.message}` : '';
    throw new Error(`Next build failed with ${describeExit(result)}${suffix}`);
  }
}

function runBuild() {
  const nextBin = require.resolve('next/dist/bin/next');
  const env = {
    ...process.env,
    NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS || '', '--max_old_space_size=6144'),
  };

  return new Promise((resolve, reject) => {
    activeChild = spawn(process.execPath, [nextBin, 'build', ...process.argv.slice(2)], {
      cwd: root,
      env,
      stdio: 'inherit',
      windowsHide: true,
    });

    activeChild.on('error', reject);
    activeChild.on('exit', (status, signal) => {
      activeChild = null;
      resolve({ status, signal });
    });
  });
}

process.on('exit', releaseLock);
process.on('SIGINT', () => {
  activeChild?.kill('SIGINT');
  releaseLock();
  process.exit(130);
});
process.on('SIGTERM', () => {
  activeChild?.kill('SIGTERM');
  releaseLock();
  process.exit(143);
});

async function main() {
  if (process.env.NEXT_BUILD_PRECHECK_ONLY === '1') {
    assertNoActiveNextDevServer();
    return;
  }
  acquireLock();
  assertNoActiveNextDevServer();
  cleanDistDir();
  require('./ensure-next-routes-js-shim.cjs');
  buildStartedAt = Date.now();
  const traceMonitor = startBuildShimMonitor();
  const devServerMonitor = startActiveNextDevServerMonitor();
  try {
    const result = await runBuild();
    const devServerError = devServerMonitor?.error();
    if (devServerError) throw devServerError;
    if (result.status !== 0) {
      await assertVerifiedBuildAfterNonZeroExit(result);
      return;
    }
    ensureBuildShims();
    ensureStaticStatusPages();
    verifyBuildCompleted();
  } finally {
    clearInterval(traceMonitor);
    devServerMonitor?.clear();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
