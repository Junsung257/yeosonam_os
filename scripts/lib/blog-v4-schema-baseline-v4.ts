import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export type SchemaObjectKind = 'table' | 'view' | 'materialized_view' | 'function' | 'procedure' | 'type' | 'extension' | 'unknown';

export type SchemaObject = {
  name: string;
  kind: SchemaObjectKind;
  providerMigration: string | null;
};

export type RequiredObject = {
  name: string;
  kind: SchemaObjectKind;
  requiredBy: string[];
  providerMigration: string | null;
  providerMigrationFound: boolean;
  providerType: 'repository_migration' | 'target_release' | 'manual_or_external' | 'extension_owned' | 'generated';
  presentAfterReplay: boolean | null;
  presentInStaging: boolean | null;
  status: 'provider_migration_not_found' | 'provider_recorded_not_checked' | 'provider_recorded_but_object_absent' | 'present';
};

export type BaselineManifest = {
  schemaVersion: 1;
  source: 'production-schema-only' | 'repository-migrations';
  containsData: false;
  sourceRefHash: string;
  schemaSha256: string;
  capturedAt: string;
  objects: Record<SchemaObjectKind, number>;
  excludedObjects: string[];
  embodiedMigrations: string[];
};

export function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\r\n]*/g, ' ');
}

export function maskDollarQuotedBodies(sql: string): string {
  return sql.replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1?\$/g, (match) => {
    const lineBreaks = match.match(/\r?\n/g)?.length ?? 0;
    return ` ${'\n'.repeat(lineBreaks)} `;
  });
}

export function normalizedSql(sql: string): string {
  return maskDollarQuotedBodies(stripSqlComments(sql));
}

function identifier(value: string): string {
  return value.replace(/^"|"$/g, '').toLowerCase();
}

function qualifiedName(schema: string | undefined, name: string): string {
  return `${identifier(schema ?? 'public')}.${identifier(name)}`;
}

export function extractSchemaObjects(sql: string, providerMigration: string | null): SchemaObject[] {
  const source = normalizedSql(sql);
  const objects: SchemaObject[] = [];
  const patterns: Array<[SchemaObjectKind, RegExp]> = [
    ['materialized_view', /\bcreate\s+materialized\s+view\s+(?:if\s+not\s+exists\s+)?(?:(\w+)\.)?"?([a-zA-Z_][\w$]*)"?/gi],
    ['view', /\bcreate\s+(?:or\s+replace\s+)?view\s+(?:(\w+)\.)?"?([a-zA-Z_][\w$]*)"?/gi],
    ['table', /\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:(\w+)\.)?"?([a-zA-Z_][\w$]*)"?/gi],
    ['function', /\bcreate\s+(?:or\s+replace\s+)?function\s+(?:(\w+)\.)?"?([a-zA-Z_][\w$]*)"?/gi],
    ['procedure', /\bcreate\s+(?:or\s+replace\s+)?procedure\s+(?:(\w+)\.)?"?([a-zA-Z_][\w$]*)"?/gi],
    ['type', /\bcreate\s+type\s+(?:(\w+)\.)?"?([a-zA-Z_][\w$]*)"?/gi],
    ['extension', /\bcreate\s+extension\s+(?:if\s+not\s+exists\s+)?"?([a-zA-Z_][\w$]*)"?/gi],
  ];
  for (const [kind, pattern] of patterns) {
    for (const match of source.matchAll(pattern)) {
      const schema = kind === 'extension' ? 'pg_catalog' : match[1];
      const name = kind === 'extension' ? match[1] : match[2];
      if (!name) continue;
      objects.push({ name: kind === 'extension' ? `${schema}.${identifier(name)}` : qualifiedName(schema, name), kind, providerMigration });
    }
  }
  return dedupeObjects(objects);
}

export function extractSchemaReferences(sql: string): Array<{ name: string; kind: SchemaObjectKind }> {
  const source = normalizedSql(sql);
  const references: Array<{ name: string; kind: SchemaObjectKind }> = [];
  const add = (name: string, kind: SchemaObjectKind = 'table') => {
    const normalized = name.toLowerCase();
    if (!normalized.includes('.')) return;
    if (normalized.startsWith('pg_catalog.') || normalized.startsWith('information_schema.')) return;
    if (['public.public', 'public.anon', 'public.authenticated', 'public.cascade', 'public.restrict', 'public.set', 'public.on', 'public.or', 'public.observed'].includes(normalized)) return;
    references.push({ name: normalized, kind });
  };

  for (const match of source.matchAll(/\b(?:from|join|update|into|references|truncate\s+table|alter\s+table|delete\s+from)\s+(?:(\w+)\.)?"?([a-zA-Z_][\w$]*)"?/gi)) {
    const schema = match[1]?.toLowerCase() ?? 'public';
    const name = match[2];
    if (name && schema === 'public') add(`public.${name}`);
  }
  for (const match of source.matchAll(/\b(public\.[a-zA-Z_][\w$]*)\s*(?:%rowtype|\()/gi)) {
    add(match[1], match[0].includes('%rowtype') ? 'table' : 'function');
  }
  for (const match of source.matchAll(/\b(?:type|::)\s+(?:(\w+)\.)?"?([a-zA-Z_][\w$]*)"?/gi)) {
    const schema = match[1]?.toLowerCase() ?? 'public';
    if (schema === 'public' && match[2]) add(`public.${match[2]}`, 'type');
  }
  return dedupeReferences(references);
}

export function dedupeObjects(objects: SchemaObject[]): SchemaObject[] {
  const seen = new Map<string, SchemaObject>();
  for (const object of objects) seen.set(`${object.kind}:${object.name}`, object);
  return [...seen.values()].sort((a, b) => `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`));
}

function dedupeReferences(references: Array<{ name: string; kind: SchemaObjectKind }>): Array<{ name: string; kind: SchemaObjectKind }> {
  const seen = new Map<string, { name: string; kind: SchemaObjectKind }>();
  for (const reference of references) seen.set(`${reference.kind}:${reference.name}`, reference);
  return [...seen.values()].sort((a, b) => `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`));
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sourceRefHash(ref: string): string {
  return sha256(ref.trim());
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function extractTopLevelSafetySurface(sql: string): string {
  return maskDollarQuotedBodies(stripSqlComments(sql));
}

export function safetyViolations(sql: string): string[] {
  const surface = extractTopLevelSafetySurface(sql);
  const violations: string[] = [];
  const checks: Array<[string, RegExp]> = [
    ['data_copy_statement', /\bcopy\s+[^;]+\s+from\s+stdin\b/i],
    ['data_insert_statement', /\binsert\s+into\b/i],
    ['data_update_statement', /\bupdate\s+(?:public\.|[a-z_])/i],
    ['data_delete_statement', /\bdelete\s+from\b/i],
    ['role_creation', /\bcreate\s+(?:user|role|database|subscription)\b/i],
    ['role_mutation', /\balter\s+(?:user|role|database|default\s+privileges)\b/i],
    ['ownership_statement', /\bowner\s+to\b/i],
    ['session_authorization', /\bset\s+(?:session\s+authorization|role)\b/i],
    ['secret_assignment', /\b(?:api[_-]?key|service[_-]?role|password|secret|token)\s*[:=]\s*'[^']{8,}'/i],
    ['secret_token_literal', /\b(?:sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/],
  ];
  for (const [code, pattern] of checks) if (pattern.test(surface)) violations.push(code);
  return violations;
}

export function sanitizeSchemaSql(sql: string): { sql: string; removedLines: string[] } {
  const removedLines: string[] = [];
  const kept = sql.split(/\r?\n/).filter((line) => {
    if (/^\s*(?:alter\s+.+\s+owner\s+to|set\s+(?:session\s+authorization|role)\b)/i.test(line)) {
      removedLines.push(line.trim().slice(0, 160));
      return false;
    }
    return true;
  });
  return { sql: kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', removedLines };
}

export function objectCounts(objects: SchemaObject[]): Record<SchemaObjectKind, number> {
  const counts: Record<SchemaObjectKind, number> = {
    table: 0,
    view: 0,
    materialized_view: 0,
    function: 0,
    procedure: 0,
    type: 0,
    extension: 0,
    unknown: 0,
  };
  for (const object of objects) counts[object.kind] += 1;
  return counts;
}
