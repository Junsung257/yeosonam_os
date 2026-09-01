import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evaluator = resolve(root, 'tools', 'harness-evals');
const npmCli = process.env.npm_execpath;

if (!npmCli || !existsSync(npmCli)) {
  console.error('Run this installer through npm run setup:harness-evals.');
  process.exit(2);
}

function run(args) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`Failed to run npm CLI: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function libcVariant() {
  if (process.platform !== 'linux') return null;
  const report = process.report?.getReport?.();
  return report?.header?.glibcVersionRuntime ? 'gnu' : 'musl';
}

function nativeBindingPackages() {
  const key = `${process.platform}-${process.arch}`;
  const libsqlBindings = {
    'darwin-arm64': '@libsql/darwin-arm64',
    'darwin-x64': '@libsql/darwin-x64',
    'win32-x64': '@libsql/win32-x64-msvc',
    'linux-arm': `@libsql/linux-arm-${libcVariant() === 'gnu' ? 'gnueabihf' : 'musleabihf'}`,
    'linux-arm64': `@libsql/linux-arm64-${libcVariant()}`,
    'linux-x64': `@libsql/linux-x64-${libcVariant()}`,
  };
  const esbuildBindings = {
    'darwin-arm64': '@esbuild/darwin-arm64',
    'darwin-x64': '@esbuild/darwin-x64',
    'win32-x64': '@esbuild/win32-x64',
    'linux-arm': '@esbuild/linux-arm',
    'linux-arm64': '@esbuild/linux-arm64',
    'linux-x64': '@esbuild/linux-x64',
  };

  const bindings = [libsqlBindings[key], esbuildBindings[key]];
  if (bindings.some((binding) => !binding)) {
    console.error(`Unsupported harness evaluator platform: ${key}`);
    process.exit(2);
  }
  return bindings;
}

run(['--prefix', evaluator, 'ci', '--ignore-scripts', '--omit=optional']);

// Promptfoo exposes many provider integrations as optional dependencies. Install
// only the locked native bindings required by the deterministic evaluator. The
// esbuild binding must be installed before its install script runs; otherwise it
// can discover a different version from the parent workspace on clean CI hosts.
const bindings = nativeBindingPackages();
const lock = JSON.parse(readFileSync(resolve(evaluator, 'package-lock.json'), 'utf8'));
const lockedBindings = bindings.map((binding) => {
  const version = lock.packages?.[`node_modules/${binding}`]?.version;
  if (!version) {
    console.error(`Missing locked version for ${binding}`);
    process.exit(2);
  }
  return `${binding}@${version}`;
});

run([
  '--prefix',
  evaluator,
  'install',
  '--no-save',
  '--package-lock=false',
  '--ignore-scripts',
  '--omit=optional',
  ...lockedBindings,
]);
run(['--prefix', evaluator, 'rebuild', 'esbuild']);
