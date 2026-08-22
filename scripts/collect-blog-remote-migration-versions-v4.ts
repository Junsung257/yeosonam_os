import { execFileSync } from 'node:child_process';

import {
  BLOG_REMOTE_MIGRATION_HISTORY_QUERY_V4,
  collectBlogRemoteMigrationEvidenceV4,
} from './lib/blog-remote-migration-evidence-v4';

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function requiredArgument(name: string): string {
  const value = argument(name)?.trim();
  if (!value) throw new Error(`blog_v4_${name.replaceAll('-', '_')}_argument_required`);
  return value;
}

function runReadOnlyMigrationQuery(query: string, workdir: string): string {
  const options = {
    cwd: workdir,
    encoding: 'utf8' as const,
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
  };
  if (query !== BLOG_REMOTE_MIGRATION_HISTORY_QUERY_V4) {
    throw new Error('blog_v4_remote_migration_query_not_allowlisted');
  }
  return process.platform === 'win32'
    ? execFileSync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$query = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(query, 'utf8').toString('base64')}')); $nodeExe = (Get-Command node).Source; $npxCli = Join-Path (Split-Path $nodeExe) 'node_modules\\npm\\bin\\npx-cli.js'; & $nodeExe $npxCli supabase db query --linked --output json $query`,
      ], options)
    : execFileSync('npx', [
        'supabase',
        'db',
        'query',
        '--linked',
        '--output',
        'json',
        query,
      ], options);
}

try {
  const environment = requiredArgument('environment');
  if (environment !== 'preview' && environment !== 'production') {
    throw new Error('blog_v4_remote_migration_environment_invalid');
  }
  const evidence = collectBlogRemoteMigrationEvidenceV4({
    expectedProjectRef: requiredArgument('expected-project-ref'),
    forbiddenProjectRef: requiredArgument('forbidden-project-ref'),
    environment,
    workdir: requiredArgument('workdir'),
    processEnv: process.env,
    allowProductionRead: process.argv.includes('--approve-production-read'),
    runReadOnlyQuery: runReadOnlyMigrationQuery,
  });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `blog V4 remote migration evidence collection failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
