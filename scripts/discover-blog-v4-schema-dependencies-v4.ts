import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import {
  extractSchemaObjects,
  extractSchemaReferences,
  objectCounts,
  readJson,
  type RequiredObject,
  type SchemaObject,
  type SchemaObjectKind,
} from './lib/blog-v4-schema-baseline-v4';

type Manifest = {
  migrations?: Array<{ version: string; file: string }>;
};

type DependencyReport = {
  schemaVersion: 1;
  generatedAt: string;
  targetMigrations: string[];
  requiredObjects: RequiredObject[];
  providerMigrations: Record<string, string | null>;
  missingProviderMigrations: RequiredObject[];
  repositoryObjects: SchemaObject[];
  status: 'baseline_ready_from_repository' | 'baseline_missing';
};

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function migrationVersion(file: string): string {
  return basename(file).match(/^(\d{14})/)?.[1] ?? basename(file);
}

function migrationFiles(migrationsDir: string): string[] {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql') && /^\d{14}/.test(file))
    .sort()
    .map((file) => resolve(migrationsDir, file));
}

function targetFiles(migrationsDir: string, manifestPath: string | null): string[] {
  if (manifestPath) {
    const manifest = readJson<Manifest>(resolve(manifestPath));
    const files = (manifest.migrations ?? []).map((entry) => resolve(entry.file));
    if (files.length === 0) throw new Error('blog_v4_target_manifest_empty');
    for (const file of files) if (!existsSync(file)) throw new Error(`blog_v4_target_migration_missing:${file}`);
    return files;
  }
  const defaultVersions = new Set([
    '20260815120135',
    '20260816015102',
    '20260818080000',
    '20260819073009',
    '20260819113000',
    '20260820100000',
    '20260820113000',
  ]);
  return migrationFiles(migrationsDir).filter((file) => defaultVersions.has(migrationVersion(file)));
}

function providerType(
  reference: { name: string; kind: SchemaObjectKind },
  providerMigration: string | null,
  targetMigrationSet: Set<string>,
): RequiredObject['providerType'] {
  if (reference.kind === 'extension' || reference.name.startsWith('pg_catalog.')) return 'extension_owned';
  if (reference.name.endsWith('_id') || reference.name.includes('gen_random')) return 'generated';
  if (providerMigration && targetMigrationSet.has(providerMigration)) return 'target_release';
  if (providerMigration) return 'repository_migration';
  return 'manual_or_external';
}

function main(): void {
  const migrationsDir = resolve(argument('migrations-dir') ?? 'supabase/migrations');
  const outputDir = resolve(argument('output-dir') ?? '.tmp/blog-v4-longrun/schema-discovery');
  const manifestPath = argument('manifest');
  const allFiles = migrationFiles(migrationsDir);
  const targetPaths = targetFiles(migrationsDir, manifestPath);
  const targetMigrationSet = new Set(targetPaths.map(migrationVersion));

  const repositoryObjects = allFiles.flatMap((file) => extractSchemaObjects(
    readFileSync(file, 'utf8'),
    migrationVersion(file),
  ));
  const providerMap = new Map<string, SchemaObject>();
  for (const object of repositoryObjects) {
    const key = `${object.kind}:${object.name}`;
    if (!providerMap.has(key)) providerMap.set(key, object);
  }

  const requiredBy = new Map<string, { name: string; kind: SchemaObjectKind; requiredBy: Set<string> }>();
  for (const file of targetPaths) {
    const migration = migrationVersion(file);
    for (const reference of extractSchemaReferences(readFileSync(file, 'utf8'))) {
      const key = `${reference.kind}:${reference.name}`;
      const entry = requiredBy.get(key) ?? { ...reference, requiredBy: new Set<string>() };
      entry.requiredBy.add(migration);
      requiredBy.set(key, entry);
    }
  }

  const tableLikeNames = new Set([...requiredBy.values()]
    .filter((reference) => ['table', 'view', 'materialized_view'].includes(reference.kind))
    .map((reference) => reference.name));
  const requiredObjects = [...requiredBy.values()]
    .filter((reference) => !(reference.kind === 'function' && tableLikeNames.has(reference.name)))
    .map((reference): RequiredObject => {
      const provider = providerMap.get(`${reference.kind}:${reference.name}`)
        ?? providerMap.get(`table:${reference.name}`)
        ?? providerMap.get(`view:${reference.name}`)
        ?? null;
      const providerMigration = provider?.providerMigration ?? null;
      return {
        name: reference.name,
        kind: reference.kind,
        requiredBy: [...reference.requiredBy].sort(),
        providerMigration,
        providerMigrationFound: providerMigration != null,
        providerType: providerType(reference, providerMigration, targetMigrationSet),
        presentAfterReplay: null,
        presentInStaging: null,
        status: providerMigration == null ? 'provider_migration_not_found' : 'provider_recorded_not_checked',
      };
    })
    .sort((a, b) => `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`));
  const missingProviderMigrations = requiredObjects.filter((entry) => entry.providerType === 'manual_or_external');
  const providerMigrations = Object.fromEntries(requiredObjects.map((entry) => [entry.name, entry.providerMigration]));
  const report: DependencyReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    targetMigrations: targetPaths.map(migrationVersion),
    requiredObjects,
    providerMigrations,
    missingProviderMigrations,
    repositoryObjects,
    status: missingProviderMigrations.length === 0 ? 'baseline_ready_from_repository' : 'baseline_missing',
  };

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, 'schema-dependencies.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(resolve(outputDir, 'required-relations.json'), `${JSON.stringify(requiredObjects.filter((entry) => ['table', 'view', 'materialized_view'].includes(entry.kind)), null, 2)}\n`);
  writeFileSync(resolve(outputDir, 'required-functions.json'), `${JSON.stringify(requiredObjects.filter((entry) => ['function', 'procedure'].includes(entry.kind)), null, 2)}\n`);
  writeFileSync(resolve(outputDir, 'required-types.json'), `${JSON.stringify(requiredObjects.filter((entry) => entry.kind === 'type'), null, 2)}\n`);
  writeFileSync(resolve(outputDir, 'required-extensions.json'), `${JSON.stringify(requiredObjects.filter((entry) => entry.kind === 'extension'), null, 2)}\n`);
  writeFileSync(resolve(outputDir, 'missing-provider-migrations.json'), `${JSON.stringify(missingProviderMigrations, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    outputDir,
    status: report.status,
    targetMigrations: report.targetMigrations,
    requiredObjectCount: requiredObjects.length,
    missingProviderMigrationCount: missingProviderMigrations.length,
    repositoryObjectCounts: objectCounts(repositoryObjects),
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`blog V4 schema dependency discovery failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
