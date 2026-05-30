/**
 * @file audit_api_field_drift.js
 *
 * Verifies that customer-facing travel_packages columns are represented in
 * PACKAGE_LIST_FIELDS. This prevents newly added package fields from silently
 * disappearing from public package APIs.
 *
 * Usage:
 *   node db/audit_api_field_drift.js
 *   node db/audit_api_field_drift.js --strict
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [k, ...rest] = line.split('=');
    if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
}

const STRICT = process.argv.includes('--strict');

// Columns intentionally hidden from customer-facing package list responses.
const INTERNAL_ONLY = new Set([
  'commission_rate',
  'commission_fixed_amount',
  'total_paid_out',
  'raw_text',
  'raw_text_hash',
  'agent_audit_report',
  'embedding',
  'theme_tags',
  'filename',
  'file_type',
  'uploaded_by',
  'settlement_confirmed',
  'paid_amount',
  'raw_extracted_text',
  'parser_version',
  'validation_errors',
  'baseline_requested_at',
  'baseline_created_at',
  'baseline_baseline_image_url',
  'quick_created',
  'category_attrs',
  'cost_price',
  'usd_cost',
  'created_by',
  'departing_location_id',
  'notes',
  'parsed_at',
  'parsed_data',
  'seats_ticketed',
  'structured_features',
  'tenant_id',
  'highlights_md',
  'itinerary_md',
  'terms_md',
]);

// Optional public metadata. Missing fields are warnings, not hard failures.
const OPTIONAL = new Set([
  'ai_confidence_score',
  'ai_tags',
  'internal_memo',
  'updated_at',
  'source_filename',
  'view_count',
  'inquiry_count',
  'expired_at',
  'is_active',
]);

function exitWithConfigMessage() {
  console.error('[drift-audit] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is not configured');
  process.exit(STRICT ? 1 : 0);
}

async function getDbColumns() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) exitWithConfigMessage();

  let raw;
  try {
    raw = execFileSync('curl', [
      '-sS',
      `${url.replace(/\/$/, '')}/rest/v1/travel_packages?select=*&limit=1`,
      '-H', `apikey: ${key}`,
      '-H', `authorization: Bearer ${key}`,
    ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    console.error('[drift-audit] travel_packages query failed:', error.message || String(error));
    process.exit(STRICT ? 1 : 0);
  }

  const data = JSON.parse(raw);
  if (!data?.[0]) {
    console.warn('[drift-audit] travel_packages is empty; cannot validate columns');
    process.exit(0);
  }
  return Object.keys(data[0]).sort();
}

function getApiSelectFields() {
  const routeFile = path.join(__dirname, '..', 'src', 'app', 'api', 'packages', 'route.ts');
  const src = fs.readFileSync(routeFile, 'utf8');
  const match = src.match(/PACKAGE_LIST_FIELDS\s*=\s*`([^`]+)`/);
  if (!match) {
    console.error('[drift-audit] PACKAGE_LIST_FIELDS constant not found');
    process.exit(STRICT ? 1 : 0);
  }

  return match[1]
    .split(',')
    .map(s => s.trim())
    .filter(s => s && !s.includes('('))
    .sort();
}

(async () => {
  const dbCols = await getDbColumns();
  const apiFields = new Set(getApiSelectFields());

  console.log(`[drift-audit] DB columns: ${dbCols.length} / API SELECT fields: ${apiFields.size}`);

  const missing = [];
  const optionalMissing = [];
  for (const col of dbCols) {
    if (apiFields.has(col)) continue;
    if (INTERNAL_ONLY.has(col)) continue;
    if (OPTIONAL.has(col)) {
      optionalMissing.push(col);
      continue;
    }
    missing.push(col);
  }

  if (missing.length === 0 && optionalMissing.length === 0) {
    console.log('[drift-audit] PASS: all customer-facing columns are synced to PACKAGE_LIST_FIELDS');
    process.exit(0);
  }

  if (optionalMissing.length > 0) {
    console.log(`[drift-audit] Optional fields missing from PACKAGE_LIST_FIELDS (${optionalMissing.length}):`);
    optionalMissing.forEach(c => console.log(`   - ${c}`));
  }

  if (missing.length > 0) {
    console.error(`[drift-audit] Required field drift detected (${missing.length}):`);
    missing.forEach(c => console.error(`   - ${c} must be added to PACKAGE_LIST_FIELDS or INTERNAL_ONLY`));
    console.error('\nFix:');
    console.error('  1) Add missing customer-facing columns to PACKAGE_LIST_FIELDS in src/app/api/packages/route.ts');
    console.error('  2) Or add intentionally hidden columns to INTERNAL_ONLY in db/audit_api_field_drift.js');
    console.error('\nGuard: run this audit as a pre-merge gate when package columns change.');
    process.exit(STRICT ? 1 : 0);
  }

  console.log('[drift-audit] PASS: only optional fields are omitted');
  process.exit(0);
})().catch(e => {
  console.error('[drift-audit] execution failed:', e);
  process.exit(STRICT ? 1 : 0);
});
