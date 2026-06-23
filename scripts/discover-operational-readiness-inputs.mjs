#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const rawArgs = process.argv.slice(2);
const json = rawArgs.includes('--json');

function argValue(name, fallback = '') {
  const prefix = `${name}=`;
  const inline = rawArgs.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = rawArgs.indexOf(name);
  return index >= 0 ? rawArgs[index + 1] ?? fallback : fallback;
}

const outPath = argValue('--out', '.tmp/operational-readiness-discovered.env');
const envFile = argValue('--env-file', process.env.OPERATIONAL_INPUTS_ENV_FILE || '');
const timeoutMs = Number(argValue('--timeout-ms', process.env.OPERATIONAL_DISCOVERY_TIMEOUT_MS || '10000'));

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
  if (!path) return [];
  const loaded = [];
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    if (!String(process.env[key] || '').trim()) process.env[key] = value;
    loaded.push(key);
  }
  return [...new Set(loaded)].sort();
}

function envValue(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function isPlaceholder(value) {
  return /^(https:\/\/example\.supabase\.co|dummy-|example-|placeholder)/i.test(String(value || '').trim());
}

function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) return null;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function isLikelyServiceRoleKey(value) {
  if (isPlaceholder(value)) return false;
  const payload = decodeJwtPayload(value);
  return payload?.role === 'service_role';
}

function fetchWithTimeout(input, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 10000);
  return fetch(input, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

function ensureParent(path) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
}

function quoteEnv(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function firstRow(data) {
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

async function safeQuery(name, queryFactory) {
  try {
    const { data, error } = await queryFactory();
    if (error) {
      return { name, status: 'blocked', error: error.message, data: null };
    }
    return { name, status: data && (Array.isArray(data) ? data.length > 0 : true) ? 'pass' : 'blocked', data };
  } catch (err) {
    return { name, status: 'blocked', error: err instanceof Error ? err.message : String(err), data: null };
  }
}

function currentOrDiscovered(key, discovered, source) {
  const current = envValue(key);
  if (current) return { key, value: current, source: 'env' };
  if (discovered) return { key, value: discovered, source };
  return { key, value: '', source: 'missing' };
}

const loadedEnvFileKeys = loadEnvFile(envFile);
const supabaseUrl = envValue('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
const serviceKey = envValue('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY');
const missingConnection = [
  !supabaseUrl || isPlaceholder(supabaseUrl) ? 'NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL' : '',
  !serviceKey || !isLikelyServiceRoleKey(serviceKey) ? 'valid service_role SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY' : '',
].filter(Boolean);

const report = {
  status: 'blocked',
  outPath,
  envFilePath: envFile || undefined,
  loadedEnvFileKeys,
  missingConnection,
  discovered: {},
  checks: [],
};

if (missingConnection.length === 0) {
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
    global: {
      fetch: fetchWithTimeout,
      headers: { 'x-application-name': 'operational-readiness-discovery' },
    },
  });

  const packageQuery = await safeQuery('travel-packages', () =>
    supabase
      .from('travel_packages')
      .select('id,status,title,display_title,updated_at')
      .in('status', ['active', 'approved', 'published'])
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(1),
  );
  let packageRow = firstRow(packageQuery.data);
  if (!packageRow && packageQuery.status !== 'pass') {
    const fallback = await safeQuery('travel-packages-fallback', () =>
      supabase
        .from('travel_packages')
        .select('id,status,title,display_title,updated_at')
        .order('updated_at', { ascending: false, nullsFirst: false })
        .limit(1),
    );
    report.checks.push(fallback);
    packageRow = firstRow(fallback.data);
  }

  const affiliateQuery = await safeQuery('affiliates', () =>
    supabase
      .from('affiliates')
      .select('referral_code,is_active,updated_at,booking_count')
      .eq('is_active', true)
      .not('referral_code', 'is', null)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(1),
  );
  let affiliateRow = firstRow(affiliateQuery.data);
  if (!affiliateRow && affiliateQuery.status !== 'pass') {
    const fallback = await safeQuery('affiliates-fallback', () =>
      supabase
        .from('affiliates')
        .select('referral_code,is_active,updated_at,booking_count')
        .not('referral_code', 'is', null)
        .order('updated_at', { ascending: false, nullsFirst: false })
        .limit(1),
    );
    report.checks.push(fallback);
    affiliateRow = firstRow(fallback.data);
  }

  const cardNewsQuery = await safeQuery('card-news', () =>
    supabase
      .from('card_news')
      .select('id,title,status,variant_group_id,updated_at')
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(20),
  );
  const cardRows = Array.isArray(cardNewsQuery.data) ? cardNewsQuery.data : [];
  const cardRow = cardRows.find((row) => row?.id) || null;
  const variantRow = cardRows.find((row) => String(row?.variant_group_id || '').trim()) || null;
  if (!variantRow) {
    const variantQuery = await safeQuery('card-news-variant-groups', () =>
      supabase
        .from('card_news')
        .select('id,title,status,variant_group_id,updated_at')
        .not('variant_group_id', 'is', null)
        .order('updated_at', { ascending: false, nullsFirst: false })
        .limit(1),
    );
    report.checks.push(variantQuery);
    const fallbackVariant = firstRow(variantQuery.data);
    if (fallbackVariant?.variant_group_id) cardRows.unshift(fallbackVariant);
  }

  report.checks.unshift(packageQuery, affiliateQuery, cardNewsQuery);
  report.discovered = {
    OPEN_CHECK_PACKAGE_ID: currentOrDiscovered('OPEN_CHECK_PACKAGE_ID', packageRow?.id, 'travel_packages.id'),
    OPEN_CHECK_REF_CODE: currentOrDiscovered('OPEN_CHECK_REF_CODE', affiliateRow?.referral_code, 'affiliates.referral_code'),
    MARKETING_CHECK_CARD_NEWS_ID: currentOrDiscovered('MARKETING_CHECK_CARD_NEWS_ID', cardRow?.id, 'card_news.id'),
    MARKETING_CHECK_VARIANT_GROUP_ID: currentOrDiscovered(
      'MARKETING_CHECK_VARIANT_GROUP_ID',
      (cardRows.find((row) => String(row?.variant_group_id || '').trim()) || {}).variant_group_id,
      'card_news.variant_group_id',
    ),
  };
} else {
  for (const key of [
    'OPEN_CHECK_PACKAGE_ID',
    'OPEN_CHECK_REF_CODE',
    'MARKETING_CHECK_CARD_NEWS_ID',
    'MARKETING_CHECK_VARIANT_GROUP_ID',
  ]) {
    report.discovered[key] = currentOrDiscovered(key, '', 'missing');
  }
}

const missing = Object.values(report.discovered)
  .filter((entry) => !entry.value)
  .map((entry) => entry.key);
report.status = missing.length === 0 ? 'pass' : 'blocked';
report.missing = missing;

const lines = [
  '# Generated by scripts/discover-operational-readiness-inputs.mjs',
  '# Contains non-secret probe identifiers for readiness automation.',
  '',
];
for (const entry of Object.values(report.discovered)) {
  if (entry.value) {
    lines.push(`# source: ${entry.source}`);
    lines.push(`${entry.key}=${quoteEnv(entry.value)}`);
  } else {
    lines.push(`# missing: ${entry.key}`);
  }
  lines.push('');
}
ensureParent(outPath);
writeFileSync(outPath, lines.join('\n'));

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Operational discovery ${report.status}: wrote ${outPath}`);
  if (missing.length > 0) console.log(`Missing: ${missing.join(', ')}`);
}

if (report.status !== 'pass') process.exitCode = 1;
