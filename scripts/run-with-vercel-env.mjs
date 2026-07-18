import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import dotenv from 'dotenv';

function quoteForShell(value) {
  if (process.platform !== 'win32') {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
  }

  const stringValue = String(value);
  if (/^[A-Za-z0-9_./:=+\\-]+$/.test(stringValue)) {
    return stringValue;
  }

  return `"${stringValue.replace(/"/g, '""')}"`;
}

function run(commandArgs, options = {}) {
  if (process.platform === 'win32') {
    return spawnSync('cmd.exe', ['/d', '/s', '/c', commandArgs.map(quoteForShell).join(' ')], {
      ...options,
      shell: false,
    });
  }

  const [command, ...args] = commandArgs;
  return spawnSync(command, args, {
    ...options,
    shell: false,
  });
}

const args = process.argv.slice(2);
let environment = 'production';
let vercelCwd = process.env.VERCEL_LINK_CWD || '';
let separatorIndex = args.indexOf('--');

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--') break;

  if (arg === '--environment' || arg === '--env') {
    environment = args[i + 1] || environment;
    i += 1;
    continue;
  }

  if (arg.startsWith('--environment=')) {
    environment = arg.split('=')[1] || environment;
    continue;
  }

  if (arg.startsWith('--env=')) {
    environment = arg.split('=')[1] || environment;
    continue;
  }

  if (arg === '--vercel-cwd') {
    vercelCwd = args[i + 1] || vercelCwd;
    i += 1;
    continue;
  }

  if (arg.startsWith('--vercel-cwd=')) {
    vercelCwd = arg.slice('--vercel-cwd='.length) || vercelCwd;
  }
}

if (separatorIndex === -1) {
  separatorIndex = args.findIndex((arg) => !arg.startsWith('--'));
}

const commandArgs = separatorIndex === -1 ? [] : args.slice(separatorIndex + (args[separatorIndex] === '--' ? 1 : 0));

if (commandArgs.length === 0) {
  console.error('Usage: node scripts/run-with-vercel-env.mjs --environment=production -- <command> [args...]');
  process.exit(1);
}

const tmpDir = mkdtempSync(join(tmpdir(), 'yeosonam-vercel-env-'));
const envPath = join(tmpDir, `${environment}.env`);
let exitCode = 0;

function readGitWorktreePaths() {
  const result = run(['git', 'worktree', 'list', '--porcelain'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0 || !result.stdout) return [];
  return result.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
    .filter(Boolean);
}

function resolveVercelCwd() {
  if (vercelCwd && existsSync(join(vercelCwd, '.vercel', 'project.json'))) {
    return vercelCwd;
  }
  if (existsSync(join(process.cwd(), '.vercel', 'project.json'))) {
    return process.cwd();
  }
  return readGitWorktreePaths().find((worktreePath) =>
    existsSync(join(worktreePath, '.vercel', 'project.json')),
  ) || process.cwd();
}

try {
  const resolvedVercelCwd = resolveVercelCwd();
  const pullArgs = ['vercel'];
  if (resolvedVercelCwd !== process.cwd()) {
    pullArgs.push('--cwd', resolvedVercelCwd);
  }
  pullArgs.push('env', 'pull', envPath, '--environment', environment, '--yes');

  const pull = run(pullArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  if (pull.error) {
    console.error(`[vercel-env] Failed to pull Vercel env: ${pull.error.message}`);
    exitCode = 1;
  }

  if (exitCode === 0 && pull.status !== 0) {
    exitCode = pull.status ?? 1;
  }

  if (exitCode === 0) {
    const parsed = dotenv.parse(readFileSync(envPath, 'utf8'));
    rmSync(envPath, { force: true });
    const childEnv = { ...process.env, ...parsed };
    console.log(`[vercel-env] Loaded ${Object.keys(parsed).length} ${environment} variables for child process.`);

    const child = run(commandArgs, {
      env: childEnv,
      stdio: 'inherit',
    });

    if (child.error) {
      console.error(`[vercel-env] Failed to run child command: ${child.error.message}`);
      exitCode = 1;
    } else {
      exitCode = child.status ?? 1;
    }
  }
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

process.exit(exitCode);
