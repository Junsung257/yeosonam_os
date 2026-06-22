import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

import { normalizeOptionalTours } from '../src/lib/package-acl';
import { buildSourceBackedFieldRepair } from '../src/lib/source-package-field-repair';
import { buildSourceBackedPriceDateRepair } from '../src/lib/source-price-date-repair';
import { buildSourceBackedTermsRepair } from '../src/lib/source-terms-repair';
import { normalizeUploadItinerary } from '../src/lib/product-registration/itinerary-normalization';
import { persistProductRegistrationDraftV3, runProductRegistrationV3 } from '../src/lib/product-registration-v3';
import type { AttractionData } from '../src/lib/attraction-matcher';

type PackageRow = {
  id: string;
  title: string | null;
  internal_code: string | null;
  destination: string | null;
  status: string | null;
  duration: number | null;
  nights: number | null;
  raw_text: string | null;
  itinerary_data: unknown;
  optional_tours: unknown;
  price_dates: unknown;
  departure_days: unknown;
  accommodations: unknown;
  inclusions: unknown;
  excludes: unknown;
  airline: string | null;
  audit_report: unknown;
};

type AttractionRow = AttractionData & { customer_publishable?: boolean | null };
type AttractionDbRow = {
  id?: string | null;
  name?: string | null;
  aliases?: unknown;
  region?: string | null;
  country?: string | null;
  short_desc?: string | null;
  long_desc?: string | null;
  badge_type?: string | null;
  emoji?: string | null;
  category?: string | null;
  mrt_gid?: string | null;
  customer_publishable?: boolean | null;
};

function loadEnvFile(file: string): void {
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

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const includePublic = argv.includes('--include-public');
const skipV3 = argv.includes('--skip-v3');
const limit = Number(argValue('limit', '50'));
const days = Number(argValue('days', '365'));
const ids = argValue('ids', '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const statusList = argValue('status', includePublic ? 'pending,pending_review,draft,approved,active' : 'pending,pending_review,draft')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error('Supabase admin env missing.');

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

function argValue(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = argv.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function isChanged(before: unknown, after: unknown): boolean {
  return stableJson(before) !== stableJson(after);
}

async function checkSupabaseRestHealth(): Promise<{ ok: boolean; reason: string; responseTimeMs: number }> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.DB_HEALTH_TIMEOUT_MS || '10000'));
  try {
    const response = await fetch(`${supabaseUrl!.replace(/\/+$/, '')}/rest/v1/`, {
      signal: controller.signal,
      headers: {
        apikey: supabaseKey!,
        authorization: `Bearer ${supabaseKey!}`,
      },
      cache: 'no-store',
    });
    return {
      ok: response.status >= 200 && response.status < 400,
      reason: `HTTP ${response.status}`,
      responseTimeMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      responseTimeMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function loadAllActiveAttractions(): Promise<AttractionRow[]> {
  const rows: AttractionRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('attractions')
      .select('id,name,aliases,region,country,short_desc,long_desc,badge_type,emoji,category,mrt_gid,customer_publishable')
      .eq('is_active', true)
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as AttractionDbRow[])
      .filter(row => Boolean(row.name?.trim()))
      .map(row => ({
        id: row.id ?? undefined,
        name: row.name!.trim(),
        aliases: Array.isArray(row.aliases) ? row.aliases.map(alias => String(alias)).filter(Boolean) : [],
        region: row.region ?? undefined,
        country: row.country ?? undefined,
        short_desc: row.short_desc ?? undefined,
        long_desc: row.long_desc ?? undefined,
        badge_type: row.badge_type ?? undefined,
        emoji: row.emoji ?? undefined,
        category: row.category ?? undefined,
        mrt_gid: row.mrt_gid ?? undefined,
        customer_publishable: row.customer_publishable ?? undefined,
      })));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function loadPackages(): Promise<PackageRow[]> {
  let query = supabase
    .from('travel_packages')
    .select('id,title,internal_code,destination,status,duration,nights,raw_text,itinerary_data,optional_tours,price_dates,departure_days,accommodations,inclusions,excludes,airline,audit_report')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (ids.length > 0) {
    query = query.in('id', ids);
  } else {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte('created_at', since).in('status', statusList);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as PackageRow[];
}

function auditReportWithRepair(pkg: PackageRow, repair: Record<string, unknown>) {
  const existing = pkg.audit_report && typeof pkg.audit_report === 'object' && !Array.isArray(pkg.audit_report)
    ? pkg.audit_report as Record<string, unknown>
    : {};
  return {
    ...existing,
    mobile_readiness_candidate_repair: {
      ...repair,
      repaired_at: new Date().toISOString(),
      version: 'candidate-repair-v1',
    },
  };
}

async function repairPackage(pkg: PackageRow, activeAttractions: AttractionRow[]) {
  const updates: Record<string, unknown> = {};
  const actions: string[] = [];
  const details: Record<string, unknown> = {};

  const priceRepair = buildSourceBackedPriceDateRepair(pkg as never);
  details.price_repair = priceRepair;
  if (priceRepair.status === 'repaired') {
    updates.price_dates = priceRepair.priceDates;
    actions.push('price_dates');
  }

  const fieldRepair = buildSourceBackedFieldRepair(pkg);
  details.field_repair = fieldRepair;
  if (fieldRepair.status === 'repaired' && fieldRepair.airline) {
    updates.airline = fieldRepair.airline;
    actions.push('airline');
  }

  const termsRepair = buildSourceBackedTermsRepair(pkg as never);
  details.terms_repair = termsRepair;
  if (termsRepair.status === 'repaired') {
    if (termsRepair.inclusions) updates.inclusions = termsRepair.inclusions;
    if (termsRepair.excludes) updates.excludes = termsRepair.excludes;
    actions.push('terms');
  }

  const normalizedItinerary = await normalizeUploadItinerary({
    itineraryData: pkg.itinerary_data as never,
    productRawText: pkg.raw_text,
    destination: pkg.destination,
    durationDays: Number.isFinite(Number(pkg.duration)) ? Number(pkg.duration) : null,
    nights: Number.isFinite(Number(pkg.nights)) ? Number(pkg.nights) : null,
    activeAttractions,
  });
  details.itinerary_warnings = normalizedItinerary.warnings;
  details.itinerary_matched = normalizedItinerary.matchedCanonicalNames;
  if (isChanged(pkg.itinerary_data, normalizedItinerary.itineraryDataToSave)) {
    updates.itinerary_data = normalizedItinerary.itineraryDataToSave;
    actions.push('itinerary_data');
  }

  const optionalTours = normalizeOptionalTours(pkg.optional_tours);
  if (isChanged(pkg.optional_tours, optionalTours)) {
    updates.optional_tours = optionalTours;
    actions.push('optional_tours');
  }

  let v3Report: Record<string, unknown> | null = null;
  if (!skipV3 && pkg.raw_text?.trim()) {
    const v3 = await runProductRegistrationV3(pkg.raw_text, {
      attractions: activeAttractions,
      destination: pkg.destination ?? undefined,
      supplierHint: pkg.destination ?? undefined,
    });
    v3Report = {
      status: v3.gate_result.status,
      attraction_unresolved: v3.match_summary.entity_summary?.attraction_unresolved_count ?? v3.match_summary.attraction_unmatched_count,
      option_review_needed: v3.match_summary.entity_summary?.option_review_needed_count ?? 0,
    };
    details.v3 = v3Report;
    if (apply) {
      const persisted = await persistProductRegistrationDraftV3(supabase as never, {
        packageId: pkg.id,
        packageTitle: pkg.title,
        rawText: pkg.raw_text,
        sourceType: 'mobile-readiness-candidate-repair',
        supplierHint: pkg.destination,
        destination: pkg.destination,
        result: v3,
      });
      details.v3_persisted = persisted;
      actions.push('v3_draft');
    }
  }

  if (actions.length > 0 && apply) {
    const now = new Date().toISOString();
    updates.audit_report = auditReportWithRepair(pkg, { actions, details });
    updates.updated_at = now;
    const { error } = await supabase
      .from('travel_packages')
      .update(updates)
      .eq('id', pkg.id);
    if (error) throw error;
  }

  return {
    id: pkg.id,
    code: pkg.internal_code,
    title: pkg.title,
    status: pkg.status,
    action: actions.length > 0 ? (apply ? 'repaired' : 'would_repair') : 'no_change',
    actions,
    details,
    updated_fields: Object.keys(updates),
  };
}

async function main() {
  const health = await checkSupabaseRestHealth();
  if (!health.ok) {
    console.log(JSON.stringify({
      status: 'blocked',
      reason: 'DB_HEALTHCHECK_TIMEOUT_OR_UNREACHABLE',
      health,
    }, null, 2));
    process.exit(1);
  }

  const [packages, activeAttractions] = await Promise.all([loadPackages(), loadAllActiveAttractions()]);
  const results = [];
  for (const pkg of packages) {
    results.push(await repairPackage(pkg, activeAttractions));
  }
  console.log(JSON.stringify({
    dry_run: !apply,
    apply,
    scanned: packages.length,
    changed: results.filter(row => row.action !== 'no_change').length,
    repaired: results.filter(row => row.action === 'repaired').length,
    active_attractions: activeAttractions.length,
    status_filter: ids.length > 0 ? null : statusList,
    results,
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
