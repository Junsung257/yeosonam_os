import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

import {
  getPackagePublicEligibilityBlockers,
  sanitizeBrokenAttractionIdsForPublicEligibility,
  sanitizeOptionalToursForPublicEligibility,
} from '../src/lib/package-public-eligibility';
import { CUSTOMER_VISIBLE_STATUSES, isCustomerVisibleStatus } from '../src/lib/visibility-status';

for (const file of ['.env.local', '.env.croncheck.local', '.env.prod', '.env']) {
  const fullPath = path.join(process.cwd(), file);
  if (fs.existsSync(fullPath)) dotenv.config({ path: fullPath, quiet: true });
}

type PackageRow = {
  id: string;
  title: string | null;
  destination: string | null;
  status: string | null;
  audit_status: string | null;
  audit_report: unknown;
  updated_at: string | null;
  optional_tours: unknown;
  itinerary_data: unknown;
};

type RepairRow = {
  id: string;
  title: string | null;
  destination: string | null;
  before_blockers: string[];
  after_blockers: string[];
  actions: string[];
  optional_tours?: {
    status: string;
    before_count: number;
    after_count: number;
    removed_count: number;
    removed: Array<{ classification: string; text: string }>;
  };
  attraction_ids?: {
    removed_count: number;
    removed: Array<{ path: string; id: unknown; reason: string }>;
  };
  demotion?: {
    from: string | null;
    to: string;
    reason: string;
  };
  applied?: boolean;
  error?: string;
};

function argValue(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const apply = process.argv.includes('--apply');
const json = process.argv.includes('--json');
const demoteIneligible = process.argv.includes('--demote-ineligible');
const demoteStatus = argValue('demote-status', 'pending_review');
const limit = Number(argValue('limit', '5000'));
const ids = argValue('ids', '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const only = new Set(
  argValue('only', 'optional,attractions')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const statusList = argValue('status', CUSTOMER_VISIBLE_STATUSES.join(','))
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const skipAttractionExistenceCheck = process.argv.includes('--skip-attraction-existence-check');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const readKey = serviceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !readKey) throw new Error('Missing Supabase environment variables.');
if (apply && !serviceKey) throw new Error('--apply requires SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY.');

const supabase = createClient(supabaseUrl, apply ? serviceKey! : readKey, {
  auth: { persistSession: false },
});

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner) => {
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return inner;
    return Object.fromEntries(Object.entries(inner).sort(([left], [right]) => left.localeCompare(right)));
  });
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function invalidateCustomerOpenContract(existingAuditReport: unknown, reason: string, now: string): Record<string, unknown> {
  const auditReport = asRecord(existingAuditReport);
  const previousContract = asRecord(auditReport.customer_open_contract);
  return {
    ...auditReport,
    customer_open_contract: {
      ok: false,
      status: 'blocked',
      checked_at: now,
      blockers: [reason],
      warnings: [],
      next_action: 'repair_then_reproof_or_review',
      stale_or_missing_proof: true,
      mobile_browser_proof: {
        ok: false,
        reason: 'public eligibility repair changed package data; refresh mobile proof and customer open contract',
      },
      previous_status: previousContract.status ?? null,
      previous_checked_at: previousContract.checked_at ?? null,
    },
  };
}

function auditReportWithRepair(pkg: PackageRow, repair: Record<string, unknown>, now: string): Record<string, unknown> {
  const auditReport = invalidateCustomerOpenContract(
    pkg.audit_report,
    'public_eligibility_repair:requires_mobile_reproof',
    now,
  );
  const previousRepairs = Array.isArray(auditReport.public_eligibility_repairs)
    ? auditReport.public_eligibility_repairs
    : [];
  return {
    ...auditReport,
    public_eligibility_repairs: [
      ...previousRepairs.slice(-9),
      {
        version: 'public-eligibility-repair-v1',
        repaired_at: now,
        ...repair,
      },
    ],
  };
}

async function fetchActiveAttractionIds(): Promise<Set<string> | undefined> {
  if (skipAttractionExistenceCheck || !only.has('attractions')) return undefined;
  const idsOut = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('attractions')
      .select('id')
      .eq('is_active', true)
      .range(from, from + 999);
    if (error) throw error;
    for (const row of data ?? []) {
      const id = typeof row.id === 'string' ? row.id.trim() : '';
      if (id) idsOut.add(id);
    }
    if (!data || data.length < 1000) break;
  }
  return idsOut;
}

async function fetchPackages(): Promise<PackageRow[]> {
  let query = supabase
    .from('travel_packages')
    .select('id,title,destination,status,audit_status,audit_report,updated_at,optional_tours,itinerary_data')
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (ids.length > 0) {
    query = query.in('id', ids);
  } else {
    query = query.in('status', statusList);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as PackageRow[];
}

function buildRepair(pkg: PackageRow, validAttractionIds?: ReadonlySet<string>) {
  const updates: Record<string, unknown> = {};
  const actions: string[] = [];
  const details: Record<string, unknown> = {};
  let optionalSummary: RepairRow['optional_tours'];
  let attractionSummary: RepairRow['attraction_ids'];

  if (only.has('optional')) {
    const optionalRepair = sanitizeOptionalToursForPublicEligibility(pkg.optional_tours);
    if (optionalRepair.repaired && stableJson(optionalRepair.optionalTours) !== stableJson(pkg.optional_tours)) {
      updates.optional_tours = optionalRepair.optionalTours;
      actions.push('optional_tours_quarantined');
      optionalSummary = {
        status: optionalRepair.status,
        before_count: arrayLength(pkg.optional_tours),
        after_count: optionalRepair.optionalTours.length,
        removed_count: optionalRepair.removed.length,
        removed: optionalRepair.removed.map((finding) => ({
          classification: finding.classification,
          text: finding.text,
        })),
      };
      details.optional_tours = {
        status: optionalRepair.status,
        removed: optionalRepair.removed,
        kept_count: optionalRepair.kept.length,
      };
    }
  }

  if (only.has('attractions')) {
    const attractionRepair = sanitizeBrokenAttractionIdsForPublicEligibility(pkg.itinerary_data, validAttractionIds);
    if (attractionRepair.repaired && stableJson(attractionRepair.itineraryData) !== stableJson(pkg.itinerary_data)) {
      updates.itinerary_data = attractionRepair.itineraryData;
      actions.push('attraction_ids_quarantined');
      attractionSummary = {
        removed_count: attractionRepair.removed.length,
        removed: attractionRepair.removed,
      };
      details.attraction_ids = {
        removed: attractionRepair.removed,
      };
    }
  }

  return { updates, actions, details, optionalSummary, attractionSummary };
}

async function main() {
  const [validAttractionIds, packages] = await Promise.all([
    fetchActiveAttractionIds(),
    fetchPackages(),
  ]);
  const rows: RepairRow[] = [];
  const now = new Date().toISOString();

  for (const pkg of packages) {
    const beforeBlockers = getPackagePublicEligibilityBlockers(pkg).map((blocker) => blocker.code);
    const repair = buildRepair(pkg, validAttractionIds);

    const simulated = {
      ...pkg,
      ...repair.updates,
      audit_report: pkg.audit_report,
      updated_at: now,
    };
    const afterBlockers = getPackagePublicEligibilityBlockers(simulated).map((blocker) => blocker.code);
    const actions = [...repair.actions];
    const updates = { ...repair.updates };
    const details = { ...repair.details };
    let demotion: RepairRow['demotion'];

    if (demoteIneligible && afterBlockers.length > 0 && isCustomerVisibleStatus(pkg.status)) {
      actions.push('status_demoted_to_review');
      updates.status = demoteStatus;
      demotion = {
        from: pkg.status ?? null,
        to: demoteStatus,
        reason: afterBlockers.join(','),
      };
      details.status_demotion = demotion;
    }

    if (actions.length === 0) continue;

    const auditReport = auditReportWithRepair(pkg, details, now);
    const row: RepairRow = {
      id: pkg.id,
      title: pkg.title,
      destination: pkg.destination,
      before_blockers: beforeBlockers,
      after_blockers: afterBlockers,
      actions,
      optional_tours: repair.optionalSummary,
      attraction_ids: repair.attractionSummary,
      demotion,
      applied: false,
    };

    if (apply) {
      const updatesToApply = {
        ...updates,
        audit_report: auditReport,
        updated_at: now,
      };
      const { error } = await supabase
        .from('travel_packages')
        .update(updatesToApply)
        .eq('id', pkg.id);
      if (error) {
        row.error = error.message || String(error);
      } else {
        row.applied = true;
      }
    }
    rows.push(row);
  }

  const summary = {
    checked_at: now,
    apply,
    demote_ineligible: demoteIneligible,
    demote_status: demoteStatus,
    status_filter: statusList,
    id_filter_count: ids.length,
    limit,
    scanned: packages.length,
    changed: rows.length,
    applied: rows.filter((row) => row.applied).length,
    active_attraction_ids_checked: validAttractionIds?.size ?? null,
    action_counts: rows.reduce<Record<string, number>>((acc, row) => {
      for (const action of row.actions) acc[action] = (acc[action] ?? 0) + 1;
      return acc;
    }, {}),
    rows,
  };

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`Checked ${summary.scanned} packages`);
  console.log(`${apply ? 'Applied' : 'Would repair'} ${summary.changed} packages`);
  for (const [action, count] of Object.entries(summary.action_counts)) {
    console.log(`- ${action}: ${count}`);
  }
  for (const row of rows.slice(0, 20)) {
    console.log(`- ${row.id} | ${row.destination ?? '-'} | ${row.actions.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
