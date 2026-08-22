import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

const VERSION_PATTERN = /^\d{14}$/;
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const MAX_EVIDENCE_BYTES = 1_048_576;

export const BLOG_REMOTE_MIGRATION_EVIDENCE_SCHEMA_V4 = 1 as const;
export const BLOG_REMOTE_MIGRATION_EVIDENCE_FILE_V4 = 'remote-migration-evidence-v4.json';
export const BLOG_REMOTE_MIGRATION_HISTORY_QUERY_V4 = `
  select json_build_object(
    'versions',
    coalesce(json_agg(version order by version), '[]'::json)
  ) as evidence
  from supabase_migrations.schema_migrations
`.trim().replace(/\s+/g, ' ');

export type BlogRemoteMigrationEnvironmentV4 = 'preview' | 'production';

export type BlogRemoteMigrationEvidenceV4 = {
  schemaVersion: typeof BLOG_REMOTE_MIGRATION_EVIDENCE_SCHEMA_V4;
  environment: BlogRemoteMigrationEnvironmentV4;
  expectedProjectRef: string;
  forbiddenProjectRef: string;
  linkedProjectRef: string;
  remoteVersions: string[];
  query: {
    kind: 'migration_history_select';
    sha256: string;
  };
  collectedAt: string;
  environmentRefSha256: string;
  evidenceSha256: string;
};

type Environment = Record<string, string | undefined>;

export type CollectBlogRemoteMigrationEvidenceInputV4 = {
  expectedProjectRef: string;
  forbiddenProjectRef: string;
  environment: BlogRemoteMigrationEnvironmentV4;
  workdir: string;
  processEnv?: Environment;
  allowProductionRead?: boolean;
  runReadOnlyQuery: (query: string, workdir: string) => string;
  now?: () => Date;
};

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function assertProjectRef(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !PROJECT_REF_PATTERN.test(value)) {
    throw new Error(`blog_v4_${field}_invalid`);
  }
}

function assertVersion(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) {
    throw new Error(`blog_v4_remote_migration_version_invalid:${String(value)}`);
  }
}

export function parseLinkedMigrationVersionsV4(output: string): string[] {
  const parsed = JSON.parse(output) as {
    rows?: Array<{ evidence?: { versions?: unknown[] } }>;
  };
  const values = parsed.rows?.[0]?.evidence?.versions;
  if (!Array.isArray(values)) throw new Error('blog_v4_remote_migration_versions_missing');
  for (const value of values) assertVersion(value);
  const versions = [...new Set(values as string[])].sort();
  if (versions.length !== values.length) throw new Error('blog_v4_remote_migration_versions_duplicate');
  return versions;
}

function projectRefFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const match = url.hostname.toLowerCase().match(/^([a-z0-9]{20})\.supabase\.co$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function assertNoProductionEnvironmentLoadedV4(
  environment: BlogRemoteMigrationEnvironmentV4,
  expectedProjectRef: string,
  processEnv: Environment = process.env,
): void {
  if (environment !== 'preview') return;

  const environmentMarkers = [
    processEnv.NODE_ENV,
    processEnv.APP_ENV,
    processEnv.ENVIRONMENT,
    processEnv.DEPLOYMENT_ENVIRONMENT,
    processEnv.VERCEL_ENV,
    processEnv.BLOG_ENVIRONMENT,
    processEnv.BLOG_V4_ENVIRONMENT,
  ].filter((value): value is string => Boolean(value?.trim()));
  if (environmentMarkers.some((value) => value.trim().toLowerCase() === 'production')) {
    throw new Error('blog_v4_production_environment_loaded');
  }

  const configuredProjectRef = processEnv.SUPABASE_PROJECT_REF?.trim().toLowerCase();
  if (configuredProjectRef && configuredProjectRef !== expectedProjectRef) {
    throw new Error('blog_v4_loaded_project_ref_mismatch');
  }

  for (const key of ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
    const value = processEnv[key]?.trim();
    if (!value) continue;
    const projectRef = projectRefFromUrl(value);
    if (projectRef && projectRef !== expectedProjectRef) {
      throw new Error(`blog_v4_loaded_${key.toLowerCase()}_mismatch`);
    }
  }
}

function readLinkedProjectRef(workdir: string): string {
  const projectRefPath = resolve(workdir, 'supabase/.temp/project-ref');
  if (!existsSync(projectRefPath)) throw new Error('blog_v4_linked_project_ref_missing');
  const projectRef = readFileSync(projectRefPath, 'utf8').trim().toLowerCase();
  assertProjectRef(projectRef, 'linked_project_ref');
  return projectRef;
}

function evidencePayload(evidence: BlogRemoteMigrationEvidenceV4): string {
  const { evidenceSha256: _evidenceSha256, ...payload } = evidence;
  return JSON.stringify(payload);
}

function environmentRefHash(
  environment: BlogRemoteMigrationEnvironmentV4,
  expectedProjectRef: string,
  forbiddenProjectRef: string,
  linkedProjectRef: string,
): string {
  return sha256([environment, expectedProjectRef, forbiddenProjectRef, linkedProjectRef].join('\n'));
}

export function validateBlogRemoteMigrationEvidenceV4(
  raw: unknown,
  options: { linkedProjectRef?: string; allowProductionRead?: boolean } = {},
): BlogRemoteMigrationEvidenceV4 {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('blog_v4_remote_migration_evidence_invalid');
  }
  const value = raw as Partial<BlogRemoteMigrationEvidenceV4>;
  if (value.schemaVersion !== BLOG_REMOTE_MIGRATION_EVIDENCE_SCHEMA_V4) {
    throw new Error('blog_v4_remote_migration_evidence_schema_invalid');
  }
  if (value.environment !== 'preview' && value.environment !== 'production') {
    throw new Error('blog_v4_remote_migration_environment_invalid');
  }
  assertProjectRef(value.expectedProjectRef, 'expected_project_ref');
  assertProjectRef(value.forbiddenProjectRef, 'forbidden_project_ref');
  assertProjectRef(value.linkedProjectRef, 'linked_project_ref');
  if (value.expectedProjectRef === value.forbiddenProjectRef) {
    throw new Error('blog_v4_expected_project_ref_forbidden');
  }
  if (value.environment === 'preview' && value.linkedProjectRef === value.forbiddenProjectRef) {
    throw new Error('blog_v4_preview_forbidden_project_linked');
  }
  if (value.environment === 'production' && options.allowProductionRead !== true) {
    throw new Error('blog_v4_production_evidence_requires_explicit_approval');
  }
  if (!Array.isArray(value.remoteVersions)) {
    throw new Error('blog_v4_remote_migration_versions_missing');
  }
  for (const version of value.remoteVersions) assertVersion(version);
  if (new Set(value.remoteVersions).size !== value.remoteVersions.length) {
    throw new Error('blog_v4_remote_migration_versions_duplicate');
  }
  if (
    !value.query
    || value.query.kind !== 'migration_history_select'
    || value.query.sha256 !== sha256(BLOG_REMOTE_MIGRATION_HISTORY_QUERY_V4)
  ) {
    throw new Error('blog_v4_remote_migration_query_evidence_invalid');
  }
  if (typeof value.collectedAt !== 'string' || !value.collectedAt) {
    throw new Error('blog_v4_remote_migration_collected_at_missing');
  }
  if (value.environmentRefSha256 !== environmentRefHash(
    value.environment,
    value.expectedProjectRef,
    value.forbiddenProjectRef,
    value.linkedProjectRef,
  )) {
    throw new Error('blog_v4_remote_migration_environment_ref_hash_invalid');
  }
  if (value.evidenceSha256 !== sha256(evidencePayload(value as BlogRemoteMigrationEvidenceV4))) {
    throw new Error('blog_v4_remote_migration_evidence_hash_invalid');
  }
  if (options.linkedProjectRef && value.linkedProjectRef !== options.linkedProjectRef) {
    throw new Error('blog_v4_remote_migration_linked_project_ref_mismatch');
  }
  return value as BlogRemoteMigrationEvidenceV4;
}

export function readAndValidateBlogRemoteMigrationEvidenceV4(
  evidencePath: string,
  options: { linkedProjectRef?: string; allowProductionRead?: boolean } = {},
): BlogRemoteMigrationEvidenceV4 {
  const absolutePath = resolve(evidencePath);
  if (!existsSync(absolutePath)) throw new Error('blog_v4_remote_migration_evidence_file_missing');
  const raw = readFileSync(absolutePath, 'utf8');
  if (Buffer.byteLength(raw, 'utf8') > MAX_EVIDENCE_BYTES) {
    throw new Error('blog_v4_remote_migration_evidence_file_too_large');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('blog_v4_remote_migration_evidence_json_invalid');
  }
  return validateBlogRemoteMigrationEvidenceV4(parsed, options);
}

export function collectBlogRemoteMigrationEvidenceV4(
  input: CollectBlogRemoteMigrationEvidenceInputV4,
): BlogRemoteMigrationEvidenceV4 {
  const expectedProjectRef = input.expectedProjectRef.trim().toLowerCase();
  const forbiddenProjectRef = input.forbiddenProjectRef.trim().toLowerCase();
  assertProjectRef(expectedProjectRef, 'expected_project_ref');
  assertProjectRef(forbiddenProjectRef, 'forbidden_project_ref');
  if (expectedProjectRef === forbiddenProjectRef) {
    throw new Error('blog_v4_expected_project_ref_forbidden');
  }
  if (input.environment !== 'preview' && input.environment !== 'production') {
    throw new Error('blog_v4_remote_migration_environment_invalid');
  }
  assertNoProductionEnvironmentLoadedV4(input.environment, expectedProjectRef, input.processEnv);
  if (input.environment === 'production' && input.allowProductionRead !== true) {
    throw new Error('blog_v4_production_read_requires_explicit_approval');
  }

  const workdir = resolve(input.workdir);
  const linkedProjectRef = readLinkedProjectRef(workdir);
  if (linkedProjectRef !== expectedProjectRef) {
    throw new Error('blog_v4_linked_project_ref_mismatch');
  }
  if (input.environment === 'preview' && linkedProjectRef === forbiddenProjectRef) {
    throw new Error('blog_v4_preview_forbidden_project_linked');
  }

  const remoteVersions = parseLinkedMigrationVersionsV4(
    input.runReadOnlyQuery(BLOG_REMOTE_MIGRATION_HISTORY_QUERY_V4, workdir),
  );
  const now = input.now ?? (() => new Date());
  const evidenceWithoutHash = {
    schemaVersion: BLOG_REMOTE_MIGRATION_EVIDENCE_SCHEMA_V4,
    environment: input.environment,
    expectedProjectRef,
    forbiddenProjectRef,
    linkedProjectRef,
    remoteVersions,
    query: {
      kind: 'migration_history_select' as const,
      sha256: sha256(BLOG_REMOTE_MIGRATION_HISTORY_QUERY_V4),
    },
    collectedAt: now().toISOString(),
    environmentRefSha256: environmentRefHash(
      input.environment,
      expectedProjectRef,
      forbiddenProjectRef,
      linkedProjectRef,
    ),
  };
  const evidence: BlogRemoteMigrationEvidenceV4 = {
    ...evidenceWithoutHash,
    evidenceSha256: sha256(JSON.stringify(evidenceWithoutHash)),
  };
  const outputPath = resolve(workdir, BLOG_REMOTE_MIGRATION_EVIDENCE_FILE_V4);
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return validateBlogRemoteMigrationEvidenceV4(evidence, { linkedProjectRef });
}
