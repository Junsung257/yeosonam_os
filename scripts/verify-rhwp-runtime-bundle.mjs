import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const distDir = process.env.NEXT_DIST_DIR?.trim() || '.next';
const tracePath = resolve(
  process.cwd(),
  distDir,
  'server',
  'app',
  '.well-known',
  'workflow',
  'v1',
  'step',
  'route.js.nft.json',
);

let trace;
try {
  trace = JSON.parse(await readFile(tracePath, 'utf8'));
} catch (error) {
  throw new Error(
    `RHWP_RUNTIME_TRACE_MISSING:${tracePath}:${error instanceof Error ? error.message : String(error)}`,
  );
}

const files = Array.isArray(trace.files) ? trace.files.map(file => String(file).replaceAll('\\', '/')) : [];
const expectedSuffixes = [
  '/vendor/rhwp/0.8.2/rhwp',
  '/vendor/rhwp/0.8.2/rhwp.exe',
];
const bundled = files.find(file => expectedSuffixes.some(suffix => `/${file}`.endsWith(suffix)));

const wasmSuffix = '/node_modules/@rhwp/core/rhwp_bg.wasm';
const wasmBundled = files.find(file => `/${file}`.endsWith(wasmSuffix));

if (!bundled) {
  throw new Error(
    `RHWP_RUNTIME_BINARY_NOT_TRACED:${tracePath}:checked=${files.length}:platformSeparator=${sep}`,
  );
}

if (!wasmBundled) {
  throw new Error(
    `RHWP_RUNTIME_WASM_NOT_TRACED:${tracePath}:checked=${files.length}:platformSeparator=${sep}`,
  );
}

console.log(`[rhwp-runtime] traced pinned native parser into workflow step: ${bundled}`);
console.log(`[rhwp-runtime] traced pinned WASM parser into workflow step: ${wasmBundled}`);
