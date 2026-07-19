/* eslint-disable @typescript-eslint/no-var-requires */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const eslintBin = path.join(
  process.cwd(),
  'node_modules',
  'eslint',
  'bin',
  'eslint.js',
);

const result = spawnSync(
  process.execPath,
  [
    eslintBin,
    'src/**/*.{js,jsx,ts,tsx}',
    '--no-eslintrc',
    '--config',
    'eslint-a11y.config.js',
    '--format=compact',
  ],
  { stdio: 'inherit', shell: false },
);

if (result.error) {
  console.error(`[a11y] failed to execute eslint: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  console.warn('[a11y] findings reported above; this audit is currently non-blocking, matching CI.');
}

process.exit(0);
