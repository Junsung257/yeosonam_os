/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');

const nextDir = path.join(process.cwd(), '.next');
const chunksDir = path.join(process.cwd(), '.next', 'static', 'chunks');
const target = path.join(chunksDir, 'main-app.js');

function ensureMainAppChunk() {
  if (!fs.existsSync(chunksDir)) {
    return;
  }

  if (fs.existsSync(target)) {
    return;
  }

  const source = fs
    .readdirSync(chunksDir)
    .filter((name) => /^main-app-[a-f0-9]+\.js$/.test(name))
    .map((name) => ({
      name,
      mtimeMs: fs.statSync(path.join(chunksDir, name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];

  if (!source) {
    const manifestPath = path.join(nextDir, 'build-manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = fs.readFileSync(manifestPath, 'utf8');
      if (manifest.includes('static/chunks/main-app.js')) {
        throw new Error('Next build manifest references static/chunks/main-app.js, but no main-app chunk was found.');
      }
    }
    return;
  }

  fs.copyFileSync(path.join(chunksDir, source.name), target);
  console.log(`[next-shim] copied ${source.name} -> main-app.js`);
}

function ensureServerChunkAliases() {
  const serverDir = path.join(nextDir, 'server');
  const serverChunksDir = path.join(serverDir, 'chunks');
  if (!fs.existsSync(serverChunksDir)) return;

  let copied = 0;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && /^\d+\.js$/.test(entry.name)) {
        const dest = path.join(serverDir, entry.name);
        if (fs.existsSync(dest)) continue;
        fs.copyFileSync(full, dest);
        copied += 1;
      }
    }
  }
  walk(serverChunksDir);

  if (copied > 0) {
    console.log(`[next-shim] copied ${copied} server chunk alias(es)`);
  }
}

function ensureAppPathsManifest() {
  const serverAppDir = path.join(nextDir, 'server', 'app');
  const manifestPath = path.join(nextDir, 'server', 'app-paths-manifest.json');
  if (!fs.existsSync(serverAppDir)) return;

  let existing = null;
  if (fs.existsSync(manifestPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      existing = null;
    }
  }
  const manifest = existing && typeof existing === 'object' ? existing : {};
  let added = 0;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && (entry.name === 'page.js' || entry.name === 'route.js')) {
        const rel = path.relative(serverAppDir, full).split(path.sep).join('/');
        const key = `/${rel.replace(/\.js$/, '')}`;
        const value = `app/${rel}`;
        if (manifest[key] !== value) {
          manifest[key] = value;
          added += 1;
        }
      }
    }
  }

  walk(serverAppDir);
  if (added > 0) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`[next-shim] added ${added} app path(s) to app-paths-manifest.json`);
  }
}

ensureMainAppChunk();
ensureServerChunkAliases();
ensureAppPathsManifest();
