import {
  prepareBlogSupabaseReleaseWorkdirV4,
  readLinkedMigrationVersionsV4,
} from './lib/blog-supabase-release-workdir-v4';

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

try {
  const output = argument('output') ?? '.tmp/blog-v4-supabase-release';
  const summary = prepareBlogSupabaseReleaseWorkdirV4({
    output,
    remoteVersions: readLinkedMigrationVersionsV4(),
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `blog V4 Supabase release workdir preparation failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
