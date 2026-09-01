import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evaluator = resolve(root, 'tools', 'harness-evals');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(args) {
  const result = spawnSync(npm, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function libcVariant() {
  if (process.platform !== 'linux') return null;
  const report = process.report?.getReport?.();
  return report?.header?.glibcVersionRuntime ? 'gnu' : 'musl';
}

function bindingPackage() {
  const key = `${process.platform}-${process.arch}`;
  const bindings = {
    'darwin-arm64': '@libsql/darwin-arm64',
    'darwin-x64': '@libsql/darwin-x64',
    'win32-x64': '@libsql/win32-x64-msvc',
    'linux-arm': `@libsql/linux-arm-${libcVariant() === 'gnu' ? 'gnueabihf' : 'musleabihf'}`,
    'linux-arm64': `@libsql/linux-arm64-${libcVariant()}`,
    'linux-x64': `@libsql/linux-x64-${libcVariant()}`,
  };

  const binding = bindings[key];
  if (!binding) {
    console.error(`Unsupported harness evaluator platform: ${key}`);
    process.exit(2);
  }
  return binding;
}

run(['--prefix', evaluator, 'ci', '--omit=optional']);

// Promptfoo exposes many provider integrations as optional dependencies. Install
// only the native libSQL binding required by the deterministic evaluator.
const binding = bindingPackage();
const lock = JSON.parse(readFileSync(resolve(evaluator, 'package-lock.json'), 'utf8'));
const version = lock.packages?.[`node_modules/${binding}`]?.version;
if (!version) {
  console.error(`Missing locked version for ${binding}`);
  process.exit(2);
}

run(['--prefix', evaluator, 'install', '--no-save', '--omit=optional', `${binding}@${version}`]);
