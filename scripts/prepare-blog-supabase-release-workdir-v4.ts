import { execFileSync } from 'node:child_process';

import {
  parseLinkedMigrationVersionsV4,
  prepareBlogSupabaseReleaseWorkdirV4,
} from './lib/blog-supabase-release-workdir-v4';

const REMOTE_VERSIONS_QUERY = `
  select json_build_object(
    'versions',
    coalesce(json_agg(version order by version), '[]'::json)
  ) as evidence
  from supabase_migrations.schema_migrations
`.trim().replace(/\s+/g, ' ');

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function readRemoteVersions(): string[] {
  const options = {
    encoding: 'utf8' as const,
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
  };
  const output = process.platform === 'win32'
    ? execFileSync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$query = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(REMOTE_VERSIONS_QUERY, 'utf8').toString('base64')}')); $nodeExe = (Get-Command node).Source; $npxCli = Join-Path (Split-Path $nodeExe) 'node_modules\\npm\\bin\\npx-cli.js'; & $nodeExe $npxCli supabase db query --linked --output json $query`,
      ], options)
    : execFileSync('npx', [
        'supabase',
        'db',
        'query',
        '--linked',
        '--output',
        'json',
        REMOTE_VERSIONS_QUERY,
      ], options);
  return parseLinkedMigrationVersionsV4(output);
}

try {
  const output = argument('output') ?? '.tmp/blog-v4-supabase-release';
  const summary = prepareBlogSupabaseReleaseWorkdirV4({
    output,
    remoteVersions: readRemoteVersions(),
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `blog V4 Supabase release workdir preparation failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
