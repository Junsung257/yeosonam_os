import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  extractSchemaObjects,
  objectCounts,
  readJson,
  safetyViolations,
  type RequiredObject,
  type SchemaObject,
} from './lib/blog-v4-schema-baseline-v4';

type Verification = {
  schemaVersion: 1;
  passed: boolean;
  containsData: false;
  requiredObjects: number;
  presentObjects: number;
  missingObjects: Array<{ name: string; kind: string; requiredBy: string[] }>;
  safetyViolations: string[];
  rlsMissing: string[];
  objectCounts: Record<string, number>;
};

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function requiredEntries(path: string): RequiredObject[] {
  const payload = readJson<unknown>(resolve(path));
  if (Array.isArray(payload)) return payload as RequiredObject[];
  if (payload && typeof payload === 'object' && 'requiredObjects' in payload) {
    return (payload as { requiredObjects: RequiredObject[] }).requiredObjects;
  }
  throw new Error('schema_baseline_required_objects_invalid');
}

function main(): void {
  const input = argument('input');
  if (!input) throw new Error('usage: --input=<baseline.sql> --required-objects=<required-relations.json>');
  const sql = readFileSync(resolve(input), 'utf8');
  const requiredPath = argument('required-objects');
  const required = requiredPath ? requiredEntries(requiredPath).filter((entry) => entry.providerType !== 'target_release') : [];
  const objects = extractSchemaObjects(sql, null);
  const objectKeys = new Set(objects.map((object) => `${object.kind}:${object.name}`));
  const relationKeys = new Set(objects.filter((object) => ['table', 'view', 'materialized_view'].includes(object.kind)).map((object) => `table:${object.name}`));
  const missingObjects = required.filter((entry) => {
    const exact = objectKeys.has(`${entry.kind}:${entry.name}`);
    const relation = ['table', 'view', 'materialized_view'].includes(entry.kind) && relationKeys.has(`table:${entry.name}`);
    return !exact && !relation;
  }).map((entry) => ({ name: entry.name, kind: entry.kind, requiredBy: entry.requiredBy }));
  const rlsMissing = process.argv.includes('--require-rls')
    ? required.filter((entry) => entry.kind === 'table' && !new RegExp(`alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:public\\.)?"?${entry.name.split('.').at(-1)}"?\\s+enable\\s+row\\s+level\\s+security`, 'i').test(sql)).map((entry) => entry.name)
    : [];
  const violations = safetyViolations(sql);
  const result: Verification = {
    schemaVersion: 1,
    passed: violations.length === 0 && missingObjects.length === 0 && rlsMissing.length === 0,
    containsData: false,
    requiredObjects: required.length,
    presentObjects: objects.length,
    missingObjects,
    safetyViolations: violations,
    rlsMissing,
    objectCounts: objectCounts(objects),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.passed) throw new Error(`schema_baseline_verification_failed:${JSON.stringify({ missingObjects, violations, rlsMissing })}`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`Yeosonam schema baseline verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
