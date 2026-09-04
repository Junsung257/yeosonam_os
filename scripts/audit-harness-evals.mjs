import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const evaluator = resolve(root, 'tools', 'harness-evals');
const npmCli = process.env.npm_execpath || (process.platform === 'win32' ? 'npm.cmd' : 'npm');
const auditArgs = ['--prefix', evaluator, 'audit', '--omit=optional', '--audit-level=high'];
const networkMarkers = [
  'audit endpoint returned an error',
  'audit network timeout',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
];

function run(args, env = process.env) {
  const command = process.env.npm_execpath ? process.execPath : npmCli;
  const commandArgs = process.env.npm_execpath ? [npmCli, ...args] : args;
  return spawnSync(command, commandArgs, {
    cwd: root,
    env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

function emit(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

const online = run(auditArgs, {
  ...process.env,
  npm_config_fetch_timeout: '30000',
  npm_config_fetch_retries: '1',
});

if (online.status === 0) {
  emit(online);
  process.exit(0);
}

const diagnostic = `${online.stdout || ''}\n${online.stderr || ''}`;
if (!networkMarkers.some((marker) => diagnostic.includes(marker))) {
  emit(online);
  process.exit(online.status ?? 1);
}

console.warn('[harness-audit] npm advisory endpoint unavailable; retrying against the local npm cache.');
const offline = run(['--offline', ...auditArgs]);
emit(offline);
process.exit(offline.status ?? 1);
