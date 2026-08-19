import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

type ArtifactEntry = {
  relative_path?: unknown;
  sha256?: unknown;
  count?: unknown;
  bytes?: unknown;
};

type SnapshotManifest = {
  version?: unknown;
  schema_version?: unknown;
  generated_at?: unknown;
  source_commit_sha?: unknown;
  source_git_ref?: unknown;
  catalog?: ArtifactEntry;
  detail?: ArtifactEntry;
};

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || null;
}

function fail(reason: string): never {
  throw new Error(`blog_snapshot_artifact_invalid:${reason}`);
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`json_read_failed:${path}:${error instanceof Error ? error.message : String(error)}`);
  }
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function safeArtifactPath(root: string, relativePath: string): string {
  const resolvedRoot = resolve(root);
  const resolved = resolve(resolvedRoot, relativePath);
  if (!resolved.startsWith(`${resolvedRoot}${sep}`)) fail(`path_escape:${relativePath}`);
  return resolved;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) fail(`${label}_not_positive`);
  return parsed;
}

function verifyEntry(root: string, entry: ArtifactEntry | undefined, label: string): number {
  const relativePath = typeof entry?.relative_path === 'string' ? entry.relative_path : null;
  const expectedSha = typeof entry?.sha256 === 'string' ? entry.sha256 : null;
  if (!relativePath || !expectedSha || !/^[a-f0-9]{64}$/i.test(expectedSha)) {
    fail(`${label}_metadata_missing`);
  }
  const artifactPath = safeArtifactPath(root, relativePath);
  if (!existsSync(artifactPath)) fail(`${label}_file_missing`);
  const actualBytes = readFileSync(artifactPath).byteLength;
  const expectedBytes = positiveInteger(entry?.bytes, `${label}_bytes`);
  if (actualBytes !== expectedBytes) fail(`${label}_bytes_mismatch`);
  const actualSha = sha256(artifactPath);
  if (actualSha.toLowerCase() !== expectedSha.toLowerCase()) fail(`${label}_sha_mismatch`);
  const body = readJson(artifactPath);
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(`${label}_body_invalid`);
  const posts = (body as { posts?: unknown }).posts;
  if (!Array.isArray(posts)) fail(`${label}_posts_missing`);
  const expectedCount = positiveInteger(entry?.count, `${label}_count`);
  if (posts.length !== expectedCount) fail(`${label}_count_mismatch`);
  return expectedCount;
}

async function main(): Promise<void> {
  const manifestPath = resolve(argument('manifest') || 'public/blog-snapshots/v3/manifest.json');
  const requireSourceCommit = process.argv.includes('--require-source-commit');
  const expectedCommit = argument('expected-commit');
  const expectedRef = argument('expected-ref');
  if (!existsSync(manifestPath)) fail('manifest_missing');
  const manifest = readJson(manifestPath) as SnapshotManifest;
  if (manifest.version !== 'blog-public-snapshot-artifacts-v3') {
    fail('schema_version_invalid');
  }
  const schemaV4 = manifest.schema_version === 4;
  if (requireSourceCommit && !schemaV4) fail('schema_version_invalid_for_production');
  if (typeof manifest.generated_at !== 'string' || !Number.isFinite(Date.parse(manifest.generated_at))) {
    fail('generated_at_invalid');
  }
  const sourceCommit = typeof manifest.source_commit_sha === 'string'
    ? manifest.source_commit_sha.trim()
    : '';
  const sourceRef = typeof manifest.source_git_ref === 'string'
    ? manifest.source_git_ref.trim()
    : '';
  if (requireSourceCommit && !/^[0-9a-f]{40}$/i.test(sourceCommit)) fail('source_commit_missing_or_invalid');
  if (expectedCommit && (!/^[0-9a-f]{40}$/i.test(expectedCommit) || sourceCommit.toLowerCase() !== expectedCommit.toLowerCase())) {
    fail('source_commit_mismatch');
  }
  if (requireSourceCommit && !sourceRef) fail('source_ref_missing');
  if (expectedRef && sourceRef !== expectedRef) fail('source_ref_mismatch');
  const root = dirname(manifestPath);
  const catalogCount = verifyEntry(root, manifest.catalog, 'catalog');
  const detailCount = verifyEntry(root, manifest.detail, 'detail');
  if (catalogCount !== detailCount) fail('catalog_detail_count_mismatch');
  process.stdout.write(`${JSON.stringify({
    ok: true,
    manifest: manifestPath,
    schemaVersion: schemaV4 ? 4 : 3,
    legacyArtifact: !schemaV4,
    sourceCommitSha: sourceCommit || null,
    sourceGitRef: sourceRef || null,
    snapshotCommitShaMatchesBuild: expectedCommit ? sourceCommit.toLowerCase() === expectedCommit.toLowerCase() : null,
    snapshotRowCount: catalogCount,
    sitemapParityInput: detailCount,
    generatedAt: manifest.generated_at,
  }, null, 2)}\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
