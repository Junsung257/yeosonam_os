#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const localEnvFile = process.env.MARKETING_ENV_LOCAL || '.env.local';
const manifestEnvFile = process.env.MARKETING_ENV_MANIFEST || '.env.prod';

function parseEnvFile(path) {
  if (!existsSync(path)) return { exists: false, values: new Map() };
  const values = new Map();
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values.set(match[1], value);
  }
  return { exists: true, values };
}

const REQUIRED_LOCAL = [
  'CRON_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'GSC_SITE_URL',
  'GSC_SERVICE_ACCOUNT_JSON',
  'GOOGLE_SERVICE_ACCOUNT_JSON',
  'META_PIXEL_ID',
  'NEXT_PUBLIC_META_PIXEL_ID',
  'META_CAPI_ACCESS_TOKEN',
];

const RECOMMENDED_LOCAL = ['INDEXNOW_KEY'];

const REQUIRED_MANIFEST = [
  'CRON_SECRET',
  'GSC_SITE_URL',
  'GSC_SERVICE_ACCOUNT_JSON',
  'GOOGLE_SERVICE_ACCOUNT_JSON',
  'INDEXNOW_KEY',
  'META_PIXEL_ID',
  'NEXT_PUBLIC_META_PIXEL_ID',
  'META_CAPI_ACCESS_TOKEN',
];

function isMissing(values, name) {
  return !values.has(name) || values.get(name).trim() === '';
}

function summarize(file, required, allowEmptyManifest = false) {
  const parsed = parseEnvFile(resolve(root, file));
  if (!parsed.exists) {
    return { file, exists: false, missing: required, empty: [] };
  }
  const missing = required.filter((name) => !parsed.values.has(name));
  const empty = allowEmptyManifest ? [] : required.filter((name) => isMissing(parsed.values, name));
  return { file, exists: true, missing, empty };
}

const local = summarize(localEnvFile, REQUIRED_LOCAL);
const manifest = summarize(manifestEnvFile, REQUIRED_MANIFEST, true);
const localValues = parseEnvFile(resolve(root, localEnvFile)).values;

const problems = [];
const warnings = [];
for (const result of [local, manifest]) {
  if (!result.exists) problems.push(`${result.file}: file missing`);
  for (const name of result.missing) problems.push(`${result.file}: ${name} missing`);
  for (const name of result.empty) problems.push(`${result.file}: ${name} empty`);
}

for (const name of RECOMMENDED_LOCAL) {
  if (isMissing(localValues, name)) {
    warnings.push(`${localEnvFile}: ${name} missing locally; production may still be configured in Vercel`);
  }
}

const gsc = localValues.get('GSC_SERVICE_ACCOUNT_JSON');
const google = localValues.get('GOOGLE_SERVICE_ACCOUNT_JSON');
if (gsc && google && gsc !== google) {
  problems.push(`${localEnvFile}: GSC_SERVICE_ACCOUNT_JSON differs from GOOGLE_SERVICE_ACCOUNT_JSON`);
}

const metaPrivate = localValues.get('META_PIXEL_ID');
const metaPublic = localValues.get('NEXT_PUBLIC_META_PIXEL_ID');
if (metaPrivate && metaPublic && metaPrivate !== metaPublic) {
  problems.push(`${localEnvFile}: META_PIXEL_ID differs from NEXT_PUBLIC_META_PIXEL_ID`);
}

const siteUrl = localValues.get('GSC_SITE_URL');
if (siteUrl && !/^https:\/\/yeosonam\.com\/?$/.test(siteUrl)) {
  problems.push(`${localEnvFile}: GSC_SITE_URL should be https://yeosonam.com/ for service-account ownership`);
}

if (problems.length > 0) {
  console.error('[marketing-env] failed');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

for (const warning of warnings) console.warn(`[marketing-env] warning: ${warning}`);
console.log('[marketing-env] ok');
