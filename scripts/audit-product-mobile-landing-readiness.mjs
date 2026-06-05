#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { mapTravelPackageToLandingData } from '../src/lib/map-travel-package-to-lp';
import { renderPackage } from '../src/lib/render-contract';

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), '.env.local'));
loadEnvFile(path.resolve(process.cwd(), '.env'));

const daysArg = Number(process.argv.find(arg => arg.startsWith('--days='))?.split('=')[1] ?? 3);
const limitArg = Number(process.argv.find(arg => arg.startsWith('--limit='))?.split('=')[1] ?? 500);
const days = Number.isFinite(daysArg) && daysArg > 0 ? daysArg : 3;
const limit = Number.isFinite(limitArg) && limitArg > 0 ? Math.min(limitArg, 2000) : 500;
const includeArchived = process.argv.includes('--include-archived');
const publicOnly = process.argv.includes('--public-only');
const jsonOnly = process.argv.includes('--json');
const strict = process.argv.includes('--strict');
const repairPriceStorage = process.argv.includes('--repair-price-storage');
const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const PUBLIC_STATUSES = new Set(['approved', 'active', 'published']);
const ARCHIVED_STATUSES = new Set(['archived', 'inactive']);

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function isArchivedStatus(status) {
  return ARCHIVED_STATUSES.has(String(status ?? '').toLowerCase());
}

function isPublicStatus(status) {
  return PUBLIC_STATUSES.has(String(status ?? '').toLowerCase());
}

function flattenNoticeText(pkg) {
  const notices = Array.isArray(pkg.notices_parsed) ? pkg.notices_parsed : [];
  return [
    ...notices.map(notice => typeof notice === 'string' ? notice : [notice?.title, notice?.text].filter(Boolean).join('\n')),
    typeof pkg.customer_notes === 'string' ? pkg.customer_notes : '',
  ].join('\n');
}

function hasStandardNoticeMeta(pkg) {
  return Array.isArray(pkg.notices_parsed)
    && pkg.notices_parsed.some(notice => isRecord(notice) && notice.template_key && notice.review_status && notice.category);
}

function hasRawLeakRisk(pkg) {
  const text = flattenNoticeText(pkg);
  if (!text.trim()) return false;
  if (hasStandardNoticeMeta(pkg)) return false;
  return /REMARK|\uB9AC\uB9C8\uD06C|\uB79C\uB4DC\uC0AC\s*(?:\uBE44\uACE0|\uC548\uB0B4)|\uC5EC\uAD8C\s*6\uAC1C\uC6D4|\uC804\uC790\s*\uB2F4\uBC30\s*\uBC18\uC785|\uB8F8\s*\uBC30\uC815|\uC77C\uC815\s*\uBBF8\uCC38\uC5EC|\uB9C8\uC0AC\uC9C0\s*\uD301|\uC2F1\uAE00\s*\uCC28\uC9C0|single\s*charge/i.test(text);
}

function trustScore(row) {
  const issues = [];
  const add = (condition, code, severity, deduction) => {
    if (condition) issues.push({ code, severity, deduction });
  };
  add(row.code_unk, 'code.unk', 'critical', 80);
  add(row.raw_notice_leak_risk, 'notice.raw_leak_risk', 'critical', 100);
  add(row.price_dates === 0 && row.price_tiers === 0 && row.product_prices === 0, 'price.missing', 'critical', 35);
  add(row.price_storage_mismatch, 'price.storage_mismatch', 'critical', 60);
  add(row.product_ledger_price_mismatch, 'price.product_ledger_mismatch', 'critical', 60);
  add(row.render_failure, 'render.blocked', 'critical', 80);
  add(row.itinerary_policy_leak, 'itinerary.policy_leak', 'critical', 80);
  add(row.itinerary_days === 0, 'itinerary.missing', 'critical', 35);
  add(row.v3 === 'blocked', 'v3.blocked', 'critical', 40);
  add(row.v3 === 'needs_review', 'v3.needs_review', 'high', 20);
  add(row.v3 === 'none', 'v3.missing', 'high', 25);
  add(row.standard_notices === 0 && row.structured_facts === 0, 'v3.facts_missing', 'medium', 15);
  add(row.unmatched_activities > 0, 'attraction.unmatched', 'medium', Math.min(20, 5 + Math.ceil(row.unmatched_activities / 10)));
  const score = issues.some(issue => issue.severity === 'critical' && issue.deduction >= 100)
    ? 0
    : Math.max(0, 100 - issues.reduce((sum, issue) => sum + issue.deduction, 0));
  return {
    score,
    publishable: score === 100 && issues.every(issue => issue.severity !== 'critical' && issue.severity !== 'high'),
    blockers: issues.filter(issue => issue.severity === 'critical' || issue.severity === 'high').map(issue => issue.code),
    warnings: issues.filter(issue => issue.severity === 'medium' || issue.severity === 'low').map(issue => issue.code),
  };
}

function countItineraryDays(pkg) {
  const days = pkg.itinerary_data?.days;
  if (Array.isArray(days)) return days.length;
  if (Array.isArray(pkg.itinerary)) return pkg.itinerary.length;
  return 0;
}

function hasUnresolvedCodeOrDestination(pkg) {
  const code = String(pkg.internal_code ?? pkg.short_code ?? '');
  const destination = String(pkg.destination ?? '').trim();
  return !destination || destination === 'UNK' || /(?:^|-)UNK(?:-|$)/.test(code);
}

function hasItineraryPolicyLeak(pkg) {
  const days = Array.isArray(pkg.itinerary_data?.days)
    ? pkg.itinerary_data.days
    : Array.isArray(pkg.itinerary)
      ? pkg.itinerary
      : [];
  return days.some(day => {
    const schedule = Array.isArray(day?.schedule) ? day.schedule : [];
    return schedule.some(item => {
      const activity = String(item?.activity ?? '');
      return /취소규정|현금영수증|예약금|수수료|환불|300,000/.test(activity);
    });
  });
}

function normalizedPriceDates(pkg) {
  return (Array.isArray(pkg.price_dates) ? pkg.price_dates : [])
    .filter(row => row?.date && Number(row?.price) > 0)
    .map(row => ({
      product_id: pkg.internal_code,
      target_date: row.date,
      day_of_week: null,
      net_price: Number(row.price),
      adult_selling_price: Number(row.price),
      child_price: null,
      note: typeof row.note === 'string' && row.note.trim() ? row.note.trim() : null,
    }));
}

function priceStorageMismatch(pkg, productPriceRows) {
  const priceDates = Array.isArray(pkg.price_dates) ? [...pkg.price_dates].filter(row => row?.date) : [];
  if (priceDates.length === 0) return null;
  const datedRows = productPriceRows.filter(row => row?.target_date);
  const pricesByDate = new Map();
  for (const row of datedRows) {
    const price = Number(row.net_price);
    if (!row.target_date || !Number.isFinite(price) || price <= 0) continue;
    const prices = pricesByDate.get(row.target_date) ?? [];
    prices.push(price);
    pricesByDate.set(row.target_date, prices);
  }
  for (const priceDate of priceDates) {
    const prices = pricesByDate.get(priceDate.date);
    if (!prices || prices.length === 0) return `product_prices missing date ${priceDate.date}`;
    const minPrice = Math.min(...prices);
    if (minPrice !== Number(priceDate.price)) {
      return `${priceDate.date} product_prices min ${minPrice} != price_dates ${Number(priceDate.price)}`;
    }
  }
  return null;
}

function productLedgerPriceMismatch(pkg, productRow) {
  if (!productRow) return null;
  const packagePrice = Number(pkg.price);
  const productNetPrice = Number(productRow.net_price);
  if (!Number.isFinite(packagePrice) || packagePrice <= 0) return null;
  if (!Number.isFinite(productNetPrice) || productNetPrice <= 0) {
    return `products.net_price missing for ${pkg.internal_code}`;
  }
  if (packagePrice !== productNetPrice) {
    return `products.net_price ${productNetPrice} != travel_packages.price ${packagePrice}`;
  }
  return null;
}

function customerPriceOptionMismatch(pkg, productPriceRows) {
  const priceDates = Array.isArray(pkg.price_dates) ? [...pkg.price_dates].filter(row => row?.date) : [];
  if (priceDates.length === 0) return null;

  const rowsByDate = new Map();
  for (const row of productPriceRows) {
    if (!row?.target_date) continue;
    const rows = rowsByDate.get(row.target_date) ?? [];
    rows.push(row);
    rowsByDate.set(row.target_date, rows);
  }

  for (const priceDate of priceDates) {
    const rows = rowsByDate.get(priceDate.date) ?? [];
    if (rows.length === 0) return `customer product price options missing date ${priceDate.date}`;
    const missingSelling = rows.find(row => {
      const selling = Number(row.adult_selling_price);
      return !Number.isFinite(selling) || selling <= 0;
    });
    if (missingSelling) return `adult_selling_price missing for ${priceDate.date}`;

    if (rows.length > 1) {
      const labels = rows
        .map(row => String(row.note ?? '').trim())
        .filter(Boolean);
      if (labels.length < rows.length) return `customer option label missing for ${priceDate.date}`;
      if (new Set(labels).size < rows.length) return `customer option labels duplicated for ${priceDate.date}`;
    }
  }

  return null;
}

function renderFailure(pkg) {
  try {
    const view = renderPackage(pkg);
    const landing = mapTravelPackageToLandingData(pkg, null);
    if (!Array.isArray(view.days) || view.days.length === 0) return 'renderPackage.days=0';
    if (!landing.priceFrom || landing.priceFrom <= 0) return 'landing.priceFrom=0';
    if (!Array.isArray(landing.price_dates) || landing.price_dates.length === 0) return 'landing.price_dates=0';
    if (!Array.isArray(landing.itinerary?.days) || landing.itinerary.days.length === 0) return 'landing.itinerary.days=0';
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function countLedgerRows(draft, key) {
  const variants = draft?.ledger?.variants;
  if (!Array.isArray(variants)) return 0;
  return variants.reduce((sum, variant) => sum + (Array.isArray(variant?.[key]) ? variant[key].length : 0), 0);
}

function gateStatus(draft) {
  return draft?.gate_result?.status ?? draft?.status ?? 'none';
}

function readinessFor(row) {
  const failures = [];
  const warnings = [];

  if (row.raw_notice_leak_risk) failures.push('raw_notice_leak_risk');
  if (row.code_unk) failures.push('code_unk');
  if (row.price_dates === 0 && row.price_tiers === 0 && row.product_prices === 0) failures.push('no_customer_price');
  if (row.price_storage_mismatch) failures.push('price_storage_mismatch');
  if (row.customer_price_option_mismatch) failures.push('customer_price_option_mismatch');
  if (row.product_ledger_price_mismatch) failures.push('product_ledger_price_mismatch');
  if (row.render_failure) failures.push('render_blocked');
  if (row.itinerary_policy_leak) failures.push('itinerary_policy_leak');
  if (row.itinerary_days === 0) failures.push('no_itinerary_days');
  if (row.v3 === 'blocked') failures.push('v3_blocked');
  if (row.v3 === 'needs_review') warnings.push('v3_needs_review');
  if (row.public && row.standard_notices === 0 && row.structured_facts === 0) warnings.push('public_without_v3_facts');
  if (row.unmatched_activities > 0) warnings.push('unmatched_activities_pending');

  return {
    status: failures.length ? 'fail' : warnings.length ? 'warn' : 'pass',
    failures,
    warnings,
  };
}

const { data: packages, error } = await supabase
  .from('travel_packages')
  .select('id, title, short_code, internal_code, status, audit_status, created_at, price, destination, duration, price_dates, price_tiers, itinerary, itinerary_data, notices_parsed, customer_notes, inclusions, excludes')
  .gte('created_at', since)
  .order('created_at', { ascending: false })
  .limit(limit);

if (error) {
  console.error(error.message);
  process.exit(1);
}

const allPackageRows = packages ?? [];
const scopedPackageRows = allPackageRows
  .filter(pkg => includeArchived || !isArchivedStatus(pkg.status))
  .filter(pkg => !publicOnly || isPublicStatus(pkg.status));
const scopedPackageIds = new Set(scopedPackageRows.map(pkg => pkg.id));
const packageIds = allPackageRows.map(pkg => pkg.id);
const internalCodes = allPackageRows.map(pkg => pkg.internal_code).filter(code => typeof code === 'string' && code.length > 0);
const draftMap = new Map();
const priceCountMap = new Map();
const productPriceRowsByCode = new Map();
const productRowsByCode = new Map();
const unmatchedCountMap = new Map();
let unmatchedScopeReady = false;
let unmatchedScopeError = null;

{
  const { error: scopeError } = await supabase
    .from('unmatched_activities')
    .select('unmatched_scope_key')
    .limit(1);
  unmatchedScopeReady = !scopeError;
  unmatchedScopeError = scopeError?.message ?? null;
}

if (packageIds.length > 0) {
  const { data: drafts, error: draftError } = await supabase
    .from('product_registration_drafts')
    .select('id, package_id, status, gate_result, ledger, created_at')
    .in('package_id', packageIds)
    .order('created_at', { ascending: false });
  if (draftError) {
    console.error(`Draft lookup failed: ${draftError.message}`);
  } else {
    for (const draft of drafts ?? []) {
      if (!draftMap.has(draft.package_id)) draftMap.set(draft.package_id, draft);
    }
  }

  if (internalCodes.length > 0) {
    const { data: priceRows, error: priceError } = await supabase
      .from('product_prices')
      .select('product_id, target_date, net_price, adult_selling_price, note')
      .in('product_id', internalCodes);
    if (!priceError) {
      for (const price of priceRows ?? []) {
        const key = price.product_id;
        priceCountMap.set(key, (priceCountMap.get(key) ?? 0) + 1);
        const rows = productPriceRowsByCode.get(key) ?? [];
        rows.push(price);
        productPriceRowsByCode.set(key, rows);
      }
    }

    const { data: productRows, error: productError } = await supabase
      .from('products')
      .select('internal_code, net_price, selling_price, margin_rate')
      .in('internal_code', internalCodes);
    if (!productError) {
      for (const product of productRows ?? []) {
        if (product.internal_code) productRowsByCode.set(product.internal_code, product);
      }
    }
  }

  const { data: unmatchedRows, error: unmatchedError } = await supabase
    .from('unmatched_activities')
    .select('package_id')
    .in('package_id', packageIds)
    .neq('status', 'ignored');
  if (!unmatchedError) {
    for (const item of unmatchedRows ?? []) {
      unmatchedCountMap.set(item.package_id, (unmatchedCountMap.get(item.package_id) ?? 0) + 1);
    }
  }
}

const priceStorageRepairs = [];
if (repairPriceStorage) {
  for (const pkg of scopedPackageRows) {
    if (!pkg.internal_code) continue;
    const replacementRows = normalizedPriceDates(pkg);
    if (replacementRows.length === 0) continue;
    const mismatch = priceStorageMismatch(pkg, productPriceRowsByCode.get(pkg.internal_code) ?? []);
    if (!mismatch) continue;

    const { error: deleteError } = await supabase
      .from('product_prices')
      .delete()
      .eq('product_id', pkg.internal_code);
    if (deleteError) {
      priceStorageRepairs.push({
        code: pkg.internal_code,
        title: pkg.title,
        ok: false,
        reason: deleteError.message,
      });
      continue;
    }

    const { error: insertError } = await supabase
      .from('product_prices')
      .insert(replacementRows);
    if (insertError) {
      priceStorageRepairs.push({
        code: pkg.internal_code,
        title: pkg.title,
        ok: false,
        reason: insertError.message,
      });
      continue;
    }

    productPriceRowsByCode.set(pkg.internal_code, replacementRows);
    priceCountMap.set(pkg.internal_code, replacementRows.length);
    priceStorageRepairs.push({
      code: pkg.internal_code,
      title: pkg.title,
      ok: true,
      before: mismatch,
      rows: replacementRows.length,
    });
  }
}

const rows = allPackageRows
  .filter(pkg => scopedPackageIds.has(pkg.id))
  .map(pkg => {
    const draft = draftMap.get(pkg.id);
    const row = {
      id: pkg.id,
      code: pkg.internal_code ?? pkg.short_code ?? '',
      title: pkg.title,
      status: pkg.status,
      public: isPublicStatus(pkg.status),
      audit: pkg.audit_status ?? '',
      created_at: pkg.created_at,
      v3: gateStatus(draft),
      draft_id: draft?.id ?? null,
      price_dates: Array.isArray(pkg.price_dates) ? pkg.price_dates.length : 0,
      price_tiers: Array.isArray(pkg.price_tiers) ? pkg.price_tiers.length : 0,
      product_prices: priceCountMap.get(pkg.internal_code) ?? 0,
      itinerary_days: countItineraryDays(pkg),
      standard_notices: countLedgerRows(draft, 'standard_notices'),
      structured_facts: countLedgerRows(draft, 'structured_facts'),
      unmatched_activities: unmatchedCountMap.get(pkg.id) ?? 0,
      code_unk: hasUnresolvedCodeOrDestination(pkg),
      raw_notice_leak_risk: hasRawLeakRisk(pkg),
      price_storage_mismatch: priceStorageMismatch(pkg, productPriceRowsByCode.get(pkg.internal_code) ?? []),
      customer_price_option_mismatch: customerPriceOptionMismatch(pkg, productPriceRowsByCode.get(pkg.internal_code) ?? []),
      product_ledger_price_mismatch: productLedgerPriceMismatch(pkg, productRowsByCode.get(pkg.internal_code)),
      itinerary_policy_leak: hasItineraryPolicyLeak(pkg),
      render_failure: renderFailure(pkg),
    };
    return { ...row, readiness: readinessFor(row), trust_score: trustScore(row) };
  });

const publicRows = rows.filter(row => row.public);
const failedRows = rows.filter(row => row.readiness.status === 'fail');
const warnedRows = rows.filter(row => row.readiness.status === 'warn');

const summary = {
  since,
  days,
  limit,
  include_archived: includeArchived,
  public_only: publicOnly,
  total: rows.length,
  public_total: publicRows.length,
  pass: rows.filter(row => row.readiness.status === 'pass').length,
  warn: warnedRows.length,
  fail: failedRows.length,
  public_fail: publicRows.filter(row => row.readiness.status === 'fail').length,
  raw_notice_leak_risk: rows.filter(row => row.raw_notice_leak_risk).length,
  code_unk: rows.filter(row => row.code_unk).length,
  no_customer_price: rows.filter(row => row.price_dates === 0 && row.price_tiers === 0 && row.product_prices === 0).length,
  price_storage_mismatch: rows.filter(row => row.price_storage_mismatch).length,
  customer_price_option_mismatch: rows.filter(row => row.customer_price_option_mismatch).length,
  product_ledger_price_mismatch: rows.filter(row => row.product_ledger_price_mismatch).length,
  render_blocked: rows.filter(row => row.render_failure).length,
  itinerary_policy_leak: rows.filter(row => row.itinerary_policy_leak).length,
  no_itinerary_days: rows.filter(row => row.itinerary_days === 0).length,
  v3_blocked: rows.filter(row => row.v3 === 'blocked').length,
  v3_needs_review: rows.filter(row => row.v3 === 'needs_review').length,
  missing_v3_draft: rows.filter(row => row.v3 === 'none').length,
  unmatched_activity_packages: rows.filter(row => row.unmatched_activities > 0).length,
  unmatched_queue_scope_ready: unmatchedScopeReady,
  unmatched_queue_scope_error: unmatchedScopeError,
  schema_failures: unmatchedScopeReady ? 0 : 1,
  repaired_price_storage: priceStorageRepairs.filter(repair => repair.ok).length,
};

const report = {
  summary,
  schema: {
    unmatched_queue_scope_ready: unmatchedScopeReady,
    unmatched_queue_scope_error: unmatchedScopeError,
    required_migration: unmatchedScopeReady ? null : 'supabase/migrations/20260605001000_unmatched_activities_package_scope.sql',
  },
  repairs: priceStorageRepairs,
  failed: failedRows.map(row => ({
    id: row.id,
    code: row.code,
    title: row.title,
    status: row.status,
    failures: row.readiness.failures,
    warnings: row.readiness.warnings,
    price_storage_mismatch: row.price_storage_mismatch,
    customer_price_option_mismatch: row.customer_price_option_mismatch,
    product_ledger_price_mismatch: row.product_ledger_price_mismatch,
    render_failure: row.render_failure,
  })),
  warnings: warnedRows.slice(0, 50).map(row => ({ id: row.id, code: row.code, title: row.title, status: row.status, warnings: row.readiness.warnings })),
  rows,
};

if (!jsonOnly) {
  console.table(rows.map(row => ({
    code: row.code,
    status: row.status,
    v3: row.v3,
    prices: row.price_dates || row.price_tiers || row.product_prices,
    code_ok: row.code_unk ? 'UNK' : 'ok',
    storage: row.price_storage_mismatch ? 'mismatch' : 'ok',
    options: row.customer_price_option_mismatch ? 'mismatch' : 'ok',
    product_ledger: row.product_ledger_price_mismatch ? 'mismatch' : 'ok',
    render: row.render_failure ? 'fail' : 'ok',
    policy: row.itinerary_policy_leak ? 'leak' : 'ok',
    days: row.itinerary_days,
    facts: row.structured_facts,
    notices: row.standard_notices,
    trust: row.trust_score.score,
    unmatched: row.unmatched_activities,
    leak: row.raw_notice_leak_risk,
    readiness: row.readiness.status,
    title: row.title,
  })));
}

console.log(JSON.stringify(jsonOnly ? report : { summary, repairs: report.repairs, failed: report.failed, warnings: report.warnings }, null, 2));

if (strict) {
  const strictFailures = [];
  if (summary.schema_failures > 0) strictFailures.push('schema_failures');
  if (summary.fail > 0) strictFailures.push('readiness_fail');
  if (summary.public_fail > 0) strictFailures.push('public_fail');
  if (summary.raw_notice_leak_risk > 0) strictFailures.push('raw_notice_leak_risk');
  if (summary.code_unk > 0) strictFailures.push('code_unk');
  if (summary.no_customer_price > 0) strictFailures.push('no_customer_price');
  if (summary.price_storage_mismatch > 0) strictFailures.push('price_storage_mismatch');
  if (summary.customer_price_option_mismatch > 0) strictFailures.push('customer_price_option_mismatch');
  if (summary.product_ledger_price_mismatch > 0) strictFailures.push('product_ledger_price_mismatch');
  if (summary.render_blocked > 0) strictFailures.push('render_blocked');
  if (summary.itinerary_policy_leak > 0) strictFailures.push('itinerary_policy_leak');
  if (summary.no_itinerary_days > 0) strictFailures.push('no_itinerary_days');
  if (summary.v3_blocked > 0) strictFailures.push('v3_blocked');
  if (strictFailures.length > 0) {
    console.error(`Strict product mobile readiness audit failed: ${strictFailures.join(', ')}`);
    process.exit(1);
  }
}
