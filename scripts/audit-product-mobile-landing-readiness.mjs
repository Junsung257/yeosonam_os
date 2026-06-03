#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

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
  add(row.raw_notice_leak_risk, 'notice.raw_leak_risk', 'critical', 100);
  add(row.price_dates === 0 && row.price_tiers === 0 && row.product_prices === 0, 'price.missing', 'critical', 35);
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
  if (row.price_dates === 0 && row.price_tiers === 0 && row.product_prices === 0) failures.push('no_customer_price');
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
  .select('id, title, short_code, status, audit_status, created_at, price_dates, price_tiers, itinerary, itinerary_data, notices_parsed, customer_notes')
  .gte('created_at', since)
  .order('created_at', { ascending: false })
  .limit(limit);

if (error) {
  console.error(error.message);
  process.exit(1);
}

const allPackageRows = packages ?? [];
const packageIds = allPackageRows.map(pkg => pkg.id);
const draftMap = new Map();
const priceCountMap = new Map();
const unmatchedCountMap = new Map();

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

  const { data: priceRows, error: priceError } = await supabase
    .from('product_prices')
    .select('package_id')
    .in('package_id', packageIds);
  if (!priceError) {
    for (const price of priceRows ?? []) {
      priceCountMap.set(price.package_id, (priceCountMap.get(price.package_id) ?? 0) + 1);
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

const rows = allPackageRows
  .filter(pkg => includeArchived || !isArchivedStatus(pkg.status))
  .filter(pkg => !publicOnly || isPublicStatus(pkg.status))
  .map(pkg => {
    const draft = draftMap.get(pkg.id);
    const row = {
      id: pkg.id,
      code: pkg.short_code ?? '',
      title: pkg.title,
      status: pkg.status,
      public: isPublicStatus(pkg.status),
      audit: pkg.audit_status ?? '',
      created_at: pkg.created_at,
      v3: gateStatus(draft),
      draft_id: draft?.id ?? null,
      price_dates: Array.isArray(pkg.price_dates) ? pkg.price_dates.length : 0,
      price_tiers: Array.isArray(pkg.price_tiers) ? pkg.price_tiers.length : 0,
      product_prices: priceCountMap.get(pkg.id) ?? 0,
      itinerary_days: countItineraryDays(pkg),
      standard_notices: countLedgerRows(draft, 'standard_notices'),
      structured_facts: countLedgerRows(draft, 'structured_facts'),
      unmatched_activities: unmatchedCountMap.get(pkg.id) ?? 0,
      raw_notice_leak_risk: hasRawLeakRisk(pkg),
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
  no_customer_price: rows.filter(row => row.price_dates === 0 && row.price_tiers === 0 && row.product_prices === 0).length,
  no_itinerary_days: rows.filter(row => row.itinerary_days === 0).length,
  v3_blocked: rows.filter(row => row.v3 === 'blocked').length,
  v3_needs_review: rows.filter(row => row.v3 === 'needs_review').length,
  missing_v3_draft: rows.filter(row => row.v3 === 'none').length,
  unmatched_activity_packages: rows.filter(row => row.unmatched_activities > 0).length,
};

const report = {
  summary,
  failed: failedRows.map(row => ({ id: row.id, code: row.code, title: row.title, status: row.status, failures: row.readiness.failures, warnings: row.readiness.warnings })),
  warnings: warnedRows.slice(0, 50).map(row => ({ id: row.id, code: row.code, title: row.title, status: row.status, warnings: row.readiness.warnings })),
  rows,
};

if (!jsonOnly) {
  console.table(rows.map(row => ({
    code: row.code,
    status: row.status,
    v3: row.v3,
    prices: row.price_dates || row.price_tiers || row.product_prices,
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

console.log(JSON.stringify(jsonOnly ? report : { summary, failed: report.failed, warnings: report.warnings }, null, 2));
