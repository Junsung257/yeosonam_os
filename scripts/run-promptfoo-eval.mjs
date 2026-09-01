import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const config = process.argv[2];
if (!config) {
  console.error('Usage: node scripts/run-promptfoo-eval.mjs <config>');
  process.exit(2);
}
const bin = resolve(root, 'tools', 'harness-evals', 'node_modules', '.bin', process.platform === 'win32' ? 'promptfoo.cmd' : 'promptfoo');
if (!existsSync(bin)) {
  console.error('Run npm --prefix tools/harness-evals ci first.');
  process.exit(2);
}
const result = spawnSync(bin, ['eval', '-c', resolve(root, config), '--no-share', '--no-cache', '--no-write', '--no-progress-bar', '--no-table'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, config.endsWith('.ts') ? '--import tsx' : ''].filter(Boolean).join(' '),
    FORCE_COLOR: '0',
    PROMPTFOO_SELF_HOSTED: '1',
    PROMPTFOO_DISABLE_TELEMETRY: '1',
    PROMPTFOO_DISABLE_UPDATE: '1',
    PROMPTFOO_DISABLE_REMOTE_GENERATION: 'true',
    PROMPTFOO_DISABLE_SHARING: '1',
    PROMPTFOO_DISABLE_TEMPLATE_ENV_VARS: 'true',
  },
});
process.exit(result.status ?? 1);
