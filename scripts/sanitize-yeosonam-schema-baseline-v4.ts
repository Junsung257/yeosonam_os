import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  extractSchemaObjects,
  objectCounts,
  readJson,
  sanitizeSchemaSql,
  safetyViolations,
  sha256,
  sourceRefHash,
  type BaselineManifest,
  type RequiredObject,
} from './lib/blog-v4-schema-baseline-v4';

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function csvArgument(name: string): string[] {
  return (argument(name) ?? '').split(',').map((value) => value.trim()).filter(Boolean);
}

function main(): void {
  const input = argument('input');
  if (!input) throw new Error('usage: --input=<schema.sql> --output-dir=<baseline-dir> --source-ref=<project-ref>');
  const outputDir = resolve(argument('output-dir') ?? 'supabase/staging-baselines/yeosonam-v1');
  const sourceRef = argument('source-ref') ?? process.env.SUPABASE_PRODUCTION_PROJECT_REF;
  if (!sourceRef) throw new Error('schema_baseline_source_ref_required');
  const raw = readFileSync(resolve(input), 'utf8');
  const violations = safetyViolations(raw);
  if (violations.length > 0) throw new Error(`schema_baseline_contains_forbidden_surface:${violations.join(',')}`);
  const sanitized = sanitizeSchemaSql(raw);
  const afterViolations = safetyViolations(sanitized.sql);
  if (afterViolations.length > 0) throw new Error(`schema_baseline_sanitize_failed:${afterViolations.join(',')}`);
  const objects = extractSchemaObjects(sanitized.sql, null);
  const requiredPath = argument('required-objects');
  const requiredObjects = requiredPath ? readJson<RequiredObject[]>(resolve(requiredPath)) : [];
  const embodiedMigrations = csvArgument('embodied-migrations');
  const pendingAfterBaseline = csvArgument('pending-after-baseline');
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, 'baseline.sql'), sanitized.sql, 'utf8');
  writeFileSync(resolve(outputDir, 'required-objects.json'), `${JSON.stringify(requiredObjects, null, 2)}\n`, 'utf8');
  writeFileSync(resolve(outputDir, 'excluded-objects.json'), `${JSON.stringify([
    'table rows',
    'auth.users rows',
    'storage object data',
    'vault secrets',
    'database roles and passwords',
    'ownership statements',
    'production-specific connection settings',
  ], null, 2)}\n`, 'utf8');
  writeFileSync(resolve(outputDir, 'migration-history.json'), `${JSON.stringify({
    schemaVersion: 1,
    embodiedMigrations,
    pendingAfterBaseline,
    historyAligned: embodiedMigrations.length > 0,
  }, null, 2)}\n`, 'utf8');
  const manifest: BaselineManifest = {
    schemaVersion: 1,
    source: 'production-schema-only',
    containsData: false,
    sourceRefHash: sourceRefHash(sourceRef),
    schemaSha256: sha256(sanitized.sql),
    capturedAt: new Date().toISOString(),
    objects: objectCounts(objects),
    excludedObjects: ['table rows', 'auth.users rows', 'storage object data', 'vault secrets', 'database roles and passwords', 'ownership statements', 'production-specific connection settings'],
    embodiedMigrations,
  };
  writeFileSync(resolve(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    outputDir,
    schemaSha256: manifest.schemaSha256,
    sourceRefHash: manifest.sourceRefHash,
    containsData: false,
    objectCounts: manifest.objects,
    removedOwnershipLines: sanitized.removedLines.length,
    historyAligned: embodiedMigrations.length > 0,
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`Yeosonam schema baseline sanitization failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
