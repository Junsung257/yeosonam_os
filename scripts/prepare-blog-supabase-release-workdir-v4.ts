import { readAndValidateBlogRemoteMigrationEvidenceV4 } from './lib/blog-remote-migration-evidence-v4';
import { prepareBlogSupabaseReleaseWorkdirV4 } from './lib/blog-supabase-release-workdir-v4';

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

try {
  const remoteEvidencePath = argument('remote-evidence');
  if (!remoteEvidencePath) throw new Error('blog_v4_remote_evidence_argument_required');
  const approveProductionEvidence = process.argv.includes('--approve-production-evidence');
  const remoteEvidence = readAndValidateBlogRemoteMigrationEvidenceV4(
    remoteEvidencePath,
    { allowProductionRead: approveProductionEvidence },
  );
  const output = argument('output') ?? '.tmp/blog-v4-supabase-release';
  const linkedWorkdir = argument('linked-workdir') ?? undefined;
  const summary = prepareBlogSupabaseReleaseWorkdirV4({
    output,
    remoteEvidence,
    linkedWorkdir,
    allowProductionEvidence: approveProductionEvidence,
    release: argument('release') === 'content_factory' ? 'content_factory' : 'orchestrator',
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `blog V4 Supabase release workdir preparation failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
