import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

type CredentialMode = 'url' | 'linked-password' | 'missing';

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function main(): void {
  const output = resolve(argument('output') ?? '.tmp/blog-v4-longrun/credential-resolution.json');
  const sourceRef = process.env.SUPABASE_PRODUCTION_PROJECT_REF?.trim() ?? '';
  const urlPresent = Boolean(process.env.SUPABASE_PRODUCTION_SCHEMA_ONLY_DATABASE_URL?.trim());
  const passwordPresent = Boolean(process.env.SUPABASE_PRODUCTION_DB_PASSWORD?.trim());
  const validRef = /^[a-z0-9]{20}$/.test(sourceRef);
  let mode: CredentialMode = 'missing';
  if (urlPresent && validRef) mode = 'url';
  else if (passwordPresent && validRef) mode = 'linked-password';
  const result = {
    schemaVersion: 1,
    mode,
    sourceRefPresent: Boolean(sourceRef),
    sourceRefValid: validRef,
    sourceRefHash: sourceRef ? hash(sourceRef) : null,
    directUrlPresent: urlPresent,
    databasePasswordPresent: passwordPresent,
    approvalPresent: process.env.BLOG_SCHEMA_READ_APPROVED === 'true',
    productionWrites: 0,
    productionReads: 0,
    secretsIncluded: false,
  };
  mkdirSync(resolve(output, '..'), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (argument('require-credential') === 'true' && mode === 'missing') {
    throw new Error('schema_read_credential_missing');
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`Blog V4 schema-read credential resolution failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
