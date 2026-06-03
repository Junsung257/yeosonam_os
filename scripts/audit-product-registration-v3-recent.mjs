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
const days = Number.isFinite(daysArg) && daysArg > 0 ? daysArg : 3;
const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
const includeArchived = process.argv.includes('--include-archived');
const repairCustomerNotices = process.argv.includes('--repair-customer-notices');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
const PUBLIC_STATUSES = new Set(['approved', 'active', 'published']);
const ARCHIVED_STATUSES = new Set(['archived', 'inactive']);

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

function hasRawLeakRisk(pkg) {
  const text = flattenNoticeText(pkg);
  if (!text.trim()) return false;
  const hasStandardMeta = Array.isArray(pkg.notices_parsed)
    && pkg.notices_parsed.some(notice => notice && typeof notice === 'object' && notice.template_key && notice.review_status);
  if (hasStandardMeta) return false;
  return /REMARK|리마크|랜드사\s*(?:비고|안내)|여권\s*6개월|전자담배\s*반입|룸\s*배정|일정\s*미참여|마사지\s*팁|싱글\s*차지|single\s*charge/i.test(text);
}

function countItineraryDays(pkg) {
  const days = pkg.itinerary_data?.days;
  if (Array.isArray(days)) return days.length;
  if (Array.isArray(pkg.itinerary)) return pkg.itinerary.length;
  return 0;
}

const { data: packages, error } = await supabase
  .from('travel_packages')
  .select('id, title, short_code, status, audit_status, created_at, price_dates, price_tiers, itinerary, itinerary_data, notices_parsed, customer_notes')
  .gte('created_at', since)
  .order('created_at', { ascending: false });

if (error) {
  console.error(error.message);
  process.exit(1);
}

const packageIds = (packages ?? []).map(pkg => pkg.id);
const draftMap = new Map();
if (packageIds.length > 0) {
  const { data: drafts, error: draftError } = await supabase
    .from('product_registration_drafts')
    .select('id, package_id, status, gate_result, created_at')
    .in('package_id', packageIds)
    .order('created_at', { ascending: false });
  if (draftError) {
    console.error(`Draft lookup failed: ${draftError.message}`);
  } else {
    for (const draft of drafts ?? []) {
      if (!draftMap.has(draft.package_id)) draftMap.set(draft.package_id, draft);
    }
  }
}

const allRows = (packages ?? []).map(pkg => {
  const draft = draftMap.get(pkg.id);
  const priceDates = Array.isArray(pkg.price_dates) ? pkg.price_dates.length : 0;
  const priceTiers = Array.isArray(pkg.price_tiers) ? pkg.price_tiers.length : 0;
  const v3Status = draft?.gate_result?.status ?? draft?.status ?? 'none';
  return {
    id: pkg.id,
    code: pkg.short_code ?? '',
    status: pkg.status,
    audit: pkg.audit_status ?? '',
    v3: v3Status,
    raw_notice_leak_risk: hasRawLeakRisk(pkg),
    price_dates: priceDates,
    price_tiers: priceTiers,
    itinerary_days: countItineraryDays(pkg),
    title: pkg.title,
    created_at: pkg.created_at,
  };
});

const rows = includeArchived ? allRows : allRows.filter(row => !isArchivedStatus(row.status));
const publicRows = rows.filter(row => isPublicStatus(row.status));
const nonPublicRows = rows.filter(row => !isPublicStatus(row.status));

console.table(rows);

const summary = {
  since,
  include_archived: includeArchived,
  archived_excluded: includeArchived ? 0 : allRows.length - rows.length,
  total: rows.length,
  public_total: publicRows.length,
  non_public_total: nonPublicRows.length,
  v3_blocked_or_review: rows.filter(row => row.v3 === 'blocked' || row.v3 === 'needs_review').length,
  raw_notice_leak_risk: rows.filter(row => row.raw_notice_leak_risk).length,
  no_price_dates: rows.filter(row => row.price_dates === 0).length,
  no_itinerary_days: rows.filter(row => row.itinerary_days === 0).length,
  public_raw_notice_leak_risk: publicRows.filter(row => row.raw_notice_leak_risk).length,
  public_no_price_dates: publicRows.filter(row => row.price_dates === 0).length,
  public_no_itinerary_days: publicRows.filter(row => row.itinerary_days === 0).length,
  non_public_raw_notice_leak_risk: nonPublicRows.filter(row => row.raw_notice_leak_risk).length,
};
console.log(JSON.stringify(summary, null, 2));

if (repairCustomerNotices) {
  const repairTargets = rows.filter(row => !isPublicStatus(row.status) && row.raw_notice_leak_risk);
  const repaired = [];
  for (const row of repairTargets) {
    const { error: repairError } = await supabase
      .from('travel_packages')
      .update({
        notices_parsed: [],
        customer_notes: '',
        status: String(row.status ?? '').toLowerCase() === 'pending' ? row.status : 'pending_review',
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    if (repairError) {
      repaired.push({ id: row.id, ok: false, error: repairError.message });
    } else {
      repaired.push({ id: row.id, ok: true, title: row.title });
    }
  }
  console.log(JSON.stringify({
    repair: 'customer_notice_raw_leak_clear',
    dry_run: false,
    target_count: repairTargets.length,
    repaired,
  }, null, 2));
}
