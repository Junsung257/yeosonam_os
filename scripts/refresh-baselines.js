#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Refresh visual baselines for packages that requested a baseline update.
 *
 * Usage:
 *   node scripts/refresh-baselines.js
 *   node scripts/refresh-baselines.js --dry-run
 *   node scripts/refresh-baselines.js --preflight
 */

const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const PREFLIGHT_ONLY = args.has('--preflight');
const BASE_URL = process.env.BASE_URL || process.env.VISUAL_TEST_URL || 'http://localhost:3000';

function stripQuotes(value) {
  return value.trim().replace(/^["']|["']$/g, '');
}

function loadEnvFileIfExists(envFilePath = path.join(__dirname, '..', '.env.local')) {
  if (!fs.existsSync(envFilePath)) {
    return { loaded: false, keys: [] };
  }

  const loadedKeys = [];
  for (const rawLine of fs.readFileSync(envFilePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;

    const [rawKey, ...rest] = line.split('=');
    const key = rawKey.trim();
    const value = stripQuotes(rest.join('='));
    if (!key || process.env[key]) continue;

    process.env[key] = value;
    loadedKeys.push(key);
  }

  return { loaded: true, keys: loadedKeys };
}

function maskValue(value) {
  if (!value) return '(missing)';
  if (value.length <= 10) return `${value.slice(0, 2)}...(${value.length} chars)`;
  return `${value.slice(0, 6)}...${value.slice(-4)} (${value.length} chars)`;
}

function resolveSupabaseEnv(env = process.env) {
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  const errors = [];

  if (!url) {
    errors.push('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL.');
  } else {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.push('Supabase URL must start with http:// or https://.');
      }
    } catch {
      errors.push('Supabase URL is not a valid URL.');
    }
  }

  if (!serviceKey) {
    errors.push('Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY.');
  } else if (serviceKey.length < 40) {
    errors.push(`Supabase service key is too short (${serviceKey.length} chars).`);
  }

  if (errors.length > 0) {
    const detail = [
      'Baseline Refresh Supabase preflight failed.',
      ...errors.map((error) => `- ${error}`),
      `Resolved URL: ${url ? maskValue(url) : '(missing)'}`,
      `Resolved service key: ${maskValue(serviceKey)}`,
      'Fix GitHub secrets NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY fallback).',
    ].join('\n');
    const error = new Error(detail);
    error.code = 'BASELINE_SUPABASE_ENV_INVALID';
    throw error;
  }

  return { url, serviceKey };
}

function createSupabaseClient() {
  loadEnvFileIfExists();
  const { url, serviceKey } = resolveSupabaseEnv();

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    realtime: {
      transport: WebSocket,
    },
  });
}

async function fetchPendingBaselinePackages(sb) {
  const { data: pending, error } = await sb
    .from('travel_packages')
    .select('id, title, short_code, status, baseline_requested_at, baseline_created_at')
    .not('baseline_requested_at', 'is', null)
    .in('status', ['approved', 'active'])
    .order('baseline_requested_at', { ascending: true });

  if (error) {
    const wrapped = new Error(
      [
        'Baseline Refresh Supabase query failed.',
        `Supabase message: ${error.message}`,
        'If this says "Invalid API key", reset GitHub secrets NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      ].join('\n'),
    );
    wrapped.cause = error;
    throw wrapped;
  }

  return (pending || []).filter(
    (pkg) =>
      !pkg.baseline_created_at ||
      new Date(pkg.baseline_created_at) < new Date(pkg.baseline_requested_at),
  );
}

async function run() {
  const sb = createSupabaseClient();
  console.log(`Baseline Queue Processor (BASE_URL=${BASE_URL}${DRY_RUN ? ' [DRY-RUN]' : ''})`);

  const toProcess = await fetchPendingBaselinePackages(sb);

  if (PREFLIGHT_ONLY) {
    console.log(`Preflight OK. Pending baseline queue: ${toProcess.length}.`);
    return;
  }

  if (toProcess.length === 0) {
    console.log('No pending baseline refresh queue. Nothing to do.');
    return;
  }

  console.log(`Pending baseline refresh queue: ${toProcess.length}`);
  for (const pkg of toProcess) {
    console.log(`  - [${pkg.status}] ${pkg.short_code || pkg.id} | ${pkg.title}`);
    console.log(
      `    requested: ${pkg.baseline_requested_at} / last_baseline: ${pkg.baseline_created_at || '(none)'}`,
    );
  }

  const fixturesPath = path.join(__dirname, '..', 'tests', 'visual', 'fixtures.json');
  const fixtures = fs.existsSync(fixturesPath)
    ? JSON.parse(fs.readFileSync(fixturesPath, 'utf8'))
    : [];
  const existingIds = new Set(fixtures.map((fixture) => fixture.id));
  const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));

  for (const pkg of toProcess) {
    if (!existingIds.has(pkg.id)) {
      const slug = (pkg.short_code || pkg.id.slice(0, 8)).toLowerCase().replace(/[^a-z0-9]/g, '-');
      const fixture = { id: pkg.id, title: pkg.title, product: slug };
      fixtures.push(fixture);
      fixtureById.set(pkg.id, fixture);
    }
  }

  if (DRY_RUN) {
    console.log('[DRY-RUN] Queue lookup succeeded. No fixture, Playwright, or DB update was performed.');
    return;
  }

  fs.writeFileSync(fixturesPath, `${JSON.stringify(fixtures, null, 2)}\n`);
  console.log(`Updated fixtures.json (${fixtures.length} total fixtures).`);

  const ids = toProcess.map((pkg) => pkg.id);
  const productKeys = toProcess
    .map((pkg) => fixtureById.get(pkg.id)?.product)
    .filter(Boolean);

  console.log('Running Playwright visual baseline update...');
  const result = spawnSync('npx', ['playwright', 'test', 'tests/visual', '--update-snapshots'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      UPDATE_BASELINE: '1',
      VISUAL_FIXTURE_IDS: ids.join(','),
      VISUAL_FIXTURE_PRODUCTS: productKeys.join(','),
      VISUAL_TEST_URL: BASE_URL,
    },
    shell: true,
  });

  if (result.status !== 0) {
    throw new Error(`Playwright baseline update failed (exit ${result.status}).`);
  }

  const now = new Date().toISOString();
  const { error: updateError } = await sb
    .from('travel_packages')
    .update({ baseline_created_at: now })
    .in('id', ids);

  if (updateError) {
    throw new Error(`Failed to update baseline_created_at: ${updateError.message}`);
  }

  console.log(`Baseline refresh complete. Updated ${ids.length} package(s).`);
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  loadEnvFileIfExists,
  resolveSupabaseEnv,
  fetchPendingBaselinePackages,
};
