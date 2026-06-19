#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const json = args.has('--json');
const apply = args.has('--apply');

function argValue(name, fallback = '') {
  const prefix = `${name}=`;
  const inline = rawArgs.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = rawArgs.indexOf(name);
  return index >= 0 ? rawArgs[index + 1] ?? fallback : fallback;
}

function fail(message) {
  const report = { status: 'fail', applied: false, error: message, secrets: [], variables: [], skipped: [] };
  if (json) console.log(JSON.stringify(report, null, 2));
  else console.error(message);
  process.exit(1);
}

function parseEnvLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trimStart() : trimmed;
  const equalIndex = normalized.indexOf('=');
  if (equalIndex <= 0) return null;
  const key = normalized.slice(0, equalIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  let value = normalized.slice(equalIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  value = value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"');
  return [key, value];
}

function loadEnvFile(path) {
  const values = {};
  const emptyKeys = [];
  if (!path) return values;
  if (!existsSync(path)) fail(`Env file not found: ${path}`);
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (!entry) continue;
    const [key, value] = entry;
    if (String(value || '').trim()) values[key] = value;
    else emptyKeys.push(key);
  }
  Object.defineProperty(values, '__emptyKeys', {
    value: emptyKeys,
    enumerable: false,
  });
  return values;
}

function supabaseProjectRef(values) {
  const url = values.SUPABASE_URL || values.NEXT_PUBLIC_SUPABASE_URL || '';
  return (String(url).match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i) || [])[1] || '';
}

function runGh(kind, key, value) {
  const commandArgs = kind === 'secret'
    ? ['secret', 'set', key, '--body', value]
    : ['variable', 'set', key, '--body', value];
  const result = spawnSync('gh', commandArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`${kind} ${key}: ${result.stderr || result.stdout || result.error?.message || 'unknown gh error'}`);
  }
}

const envFile = argValue('--env-file', '');
const discoveredEnvFile = argValue('--discovered-env-file', '');
if (!envFile && !discoveredEnvFile) {
  fail('Usage: node scripts/sync-vercel-env-to-github-actions.mjs --env-file=.tmp/vercel.env [--discovered-env-file=.tmp/discovered.env] [--apply]');
}

const primaryValues = loadEnvFile(envFile);
const discoveredValues = loadEnvFile(discoveredEnvFile);
const envValues = { ...primaryValues, ...discoveredValues };
const emptyEnvFileKeys = [
  ...(primaryValues.__emptyKeys || []),
  ...(discoveredValues.__emptyKeys || []),
];

const derivedRef = supabaseProjectRef(envValues);
if (derivedRef && !envValues.SUPABASE_PROJECT_REF) envValues.SUPABASE_PROJECT_REF = derivedRef;

const contract = JSON.parse(readFileSync('src/config/runtime-env-readiness.json', 'utf8'));
const aliasKeys = Object.values(contract.aliases || {})
  .flatMap((value) => (Array.isArray(value) ? value : []));

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

const variableKeys = unique([
  'OPEN_CHECK_PACKAGE_ID',
  'OPEN_CHECK_REF_CODE',
  'MARKETING_CHECK_CARD_NEWS_ID',
  'MARKETING_CHECK_VARIANT_GROUP_ID',
  'SUPABASE_PROJECT_REF',
  'NAVER_CLIENT_ID',
  'META_AD_ACCOUNT_ID',
  'META_APP_ID',
  'THREADS_USER_ID',
  'AD_FLAG_UP_BID_FACTOR',
  'AD_OFFPEAK_BID_FACTOR',
  'AD_MIN_BID_KRW',
  'NAVER_CAFE_ID',
  'NAVER_ADS_CUSTOMER_ID',
  'GOOGLE_ADS_CUSTOMER_ID',
  'GOOGLE_ADS_CONVERSION_ACTION_ID',
]);

const secretKeys = unique([
  'SERPAPI_KEY',
  'NAVER_CLIENT_SECRET',
  'META_ACCESS_TOKEN',
  'META_ADS_ACCESS_TOKEN',
  'META_APP_SECRET',
  'THREADS_ACCESS_TOKEN',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CRON_SECRET',
  'BAND_RSS_URL',
  'TWITTER_BEARER_TOKEN',
  'X_BEARER_TOKEN',
  'NAVER_ADS_API_KEY',
  'NAVER_ADS_SECRET_KEY',
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_CLIENT_ID',
  'GOOGLE_ADS_CLIENT_SECRET',
  'GOOGLE_ADS_REFRESH_TOKEN',
  'SLACK_WEBHOOK_URL',
  'SLACK_PAYMENTS_WEBHOOK_URL',
  'SLACK_ALERT_WEBHOOK_URL',
  'SLACK_ALERTS_WEBHOOK',
  'SLACK_ALERTS_WEBHOOK_URL',
  'SLACK_CWV_WEBHOOK_URL',
  ...aliasKeys.filter((key) => ![
    'META_ADS_ACCESS_TOKEN',
    'X_BEARER_TOKEN',
    'SLACK_PAYMENTS_WEBHOOK_URL',
    'SLACK_ALERTS_WEBHOOK',
    'SLACK_ALERTS_WEBHOOK_URL',
    'SLACK_CWV_WEBHOOK_URL',
  ].includes(key)),
]);

const variables = [];
const secrets = [];
const skipped = [];
const empty = [];

for (const key of variableKeys) {
  if (envValues[key]) variables.push(key);
  else if (emptyEnvFileKeys.includes(key)) empty.push(key);
  else skipped.push(key);
}

for (const key of secretKeys) {
  if (envValues[key]) secrets.push(key);
  else if (emptyEnvFileKeys.includes(key)) empty.push(key);
  else skipped.push(key);
}

try {
  if (apply) {
    for (const key of variables) runGh('variable', key, envValues[key]);
    for (const key of secrets) runGh('secret', key, envValues[key]);
  }
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

const report = {
  status: 'pass',
  applied: apply,
  variables,
  secrets,
  empty: [...new Set(empty)].sort(),
  skipped: [...new Set(skipped)].sort(),
  notes: empty.length > 0
    ? 'Empty values in a Vercel env pull may be true blanks or sensitive values that are non-readable by the CLI; provide the original values when syncing them to GitHub Actions.'
    : '',
};

if (json) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`${apply ? 'Applied' : 'Dry-run'} GitHub Actions env sync.`);
  console.log(`Variables: ${variables.join(', ') || '(none)'}`);
  console.log(`Secrets: ${secrets.join(', ') || '(none)'}`);
  if (empty.length) console.log(`Empty or non-exportable in env file: ${[...new Set(empty)].sort().join(', ')}`);
  if (skipped.length) console.log(`Skipped: ${[...new Set(skipped)].sort().join(', ')}`);
}
