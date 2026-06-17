/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const distDir = path.resolve(root, process.env.NEXT_DIST_DIR || '.next');

const requiredPaths = [
  'BUILD_ID',
  'app-build-manifest.json',
  'build-manifest.json',
  'server',
  'static',
];

const missing = requiredPaths.filter((entry) => !fs.existsSync(path.join(distDir, entry)));

for (const manifest of ['app-build-manifest.json', 'build-manifest.json']) {
  const manifestPath = path.join(distDir, manifest);
  if (!fs.existsSync(manifestPath)) continue;
  try {
    JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    missing.push(`${manifest}:invalid-json:${err instanceof Error ? err.message : String(err)}`);
  }
}

if (missing.length > 0) {
  console.error(`[next-build-output] incomplete production build: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`[next-build-output] verified ${path.relative(root, distDir) || distDir}`);
