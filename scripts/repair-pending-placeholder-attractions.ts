#!/usr/bin/env tsx

import process from 'node:process';

import './load-script-env';

import { supabaseAdmin } from '@/lib/supabase';
import { repairMojibakeAttractionNamesInItinerary } from '@/lib/product-registration/upload-to-open-autopilot';

const DEFAULT_CODES = [
  'PUS-ETC-CXR-05-0020',
  'PUS-ETC-CXR-05-0019',
  'PUS-ETC-FUK-03-0014',
  'PUS-ETC-CXR-05-0005',
];

type PackageRow = {
  id: string;
  internal_code: string | null;
  title: string | null;
  status: string | null;
  audit_status: string | null;
  audit_report: Record<string, unknown> | null;
  itinerary_data: unknown;
};

type AttractionRow = {
  id: string;
  name: string | null;
  aliases: string[] | null;
  customer_publishable: boolean | null;
  verification_status: string | null;
};

type Options = {
  apply: boolean;
  json: boolean;
  codes: string[];
  repairHiddenAttractionMasters: boolean;
};

function parseOptions(args: string[]): Options {
  const codesArg = args.find((arg) => arg.startsWith('--codes='))?.split('=')[1];
  const codes = codesArg
    ? codesArg.split(',').map((code) => code.trim()).filter(Boolean)
    : DEFAULT_CODES;

  return {
    apply: args.includes('--apply'),
    json: args.includes('--json'),
    codes,
    repairHiddenAttractionMasters: !args.includes('--skip-master-repair'),
  };
}

function isBrokenPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && /(?:\?{2,}|\uFFFD)/.test(value);
}

function countBrokenPlaceholders(value: unknown): number {
  if (isBrokenPlaceholder(value)) return 1;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countBrokenPlaceholders(item), 0);
  if (!value || typeof value !== 'object') return 0;
  return Object.values(value as Record<string, unknown>).reduce(
    (sum: number, item: unknown) => sum + countBrokenPlaceholders(item),
    0,
  );
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function collectMasterRepairs(before: unknown, after: unknown): Map<string, string> {
  const repairs = new Map<string, string>();
  const beforeRoot = asRecord(before);
  const afterRoot = asRecord(after);
  const beforeDays = Array.isArray(beforeRoot?.days) ? beforeRoot.days : [];
  const afterDays = Array.isArray(afterRoot?.days) ? afterRoot.days : [];

  beforeDays.forEach((beforeDay: { schedule?: unknown }, dayIndex: number) => {
    const beforeSchedule = Array.isArray(beforeDay?.schedule) ? beforeDay.schedule : [];
    const afterSchedule = Array.isArray(afterDays[dayIndex]?.schedule) ? afterDays[dayIndex].schedule : [];

    beforeSchedule.forEach((beforeItem: { attraction_names?: unknown }, scheduleIndex: number) => {
      const afterItem = asRecord(afterSchedule[scheduleIndex]);
      const beforeNames = asStringArray(beforeItem?.attraction_names);
      const afterNames = asStringArray(afterItem?.attraction_names);
      if (!beforeNames.some(isBrokenPlaceholder)) return;

      const repairedName = afterNames.find((name) => !isBrokenPlaceholder(name));
      if (!repairedName) return;

      for (const id of asStringArray(afterItem?.attraction_ids)) {
        repairs.set(id, repairedName);
      }
    });
  });

  return repairs;
}

async function repairHiddenAttractionMasters(masterRepairs: Map<string, string>, apply: boolean) {
  if (masterRepairs.size === 0) return [];

  const ids = [...masterRepairs.keys()];
  const { data, error } = await supabaseAdmin
    .from('attractions')
    .select('id,name,aliases,customer_publishable,verification_status')
    .in('id', ids);
  if (error) throw new Error(error.message);

  const results = [];
  for (const row of (data ?? []) as AttractionRow[]) {
    const nextName = masterRepairs.get(row.id);
    if (!nextName) continue;
    const eligible =
      !row.customer_publishable &&
      row.verification_status === 'auto_internal' &&
      isBrokenPlaceholder(row.name);
    const aliases = Array.from(new Set([nextName, ...asStringArray(row.aliases).filter((alias) => !isBrokenPlaceholder(alias))]));

    if (eligible && apply) {
      const { error: updateError } = await supabaseAdmin
        .from('attractions')
        .update({
          name: nextName,
          aliases,
          review_required_reason: 'hidden_auto_internal_name_repaired_from_source_backed_itinerary',
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      if (updateError) {
        results.push({
          id: row.id,
          before: row.name,
          after: nextName,
          eligible,
          applied: false,
          skippedReason: updateError.code === '23505'
            ? 'duplicate_attraction_name_requires_merge_alias'
            : updateError.message,
        });
        continue;
      }
    }

    results.push({
      id: row.id,
      before: row.name,
      after: nextName,
      eligible,
      applied: eligible && apply,
      skippedReason: null,
    });
  }

  return results;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const { data, error } = await supabaseAdmin
    .from('travel_packages')
    .select('id,internal_code,title,status,audit_status,audit_report,itinerary_data')
    .in('internal_code', options.codes)
    .order('internal_code', { ascending: true });
  if (error) throw new Error(error.message);

  const packages = (data ?? []) as PackageRow[];
  const allMasterRepairs = new Map<string, string>();
  const results = [];

  for (const pkg of packages) {
    const beforeCount = countBrokenPlaceholders(pkg.itinerary_data);
    const repair = repairMojibakeAttractionNamesInItinerary(pkg.itinerary_data);
    const afterCount = countBrokenPlaceholders(repair.itineraryData);
    const masterRepairs = collectMasterRepairs(pkg.itinerary_data, repair.itineraryData);
    for (const [id, name] of masterRepairs.entries()) allMasterRepairs.set(id, name);

    const auditReport = {
      ...(pkg.audit_report ?? {}),
      pending_placeholder_attraction_repair_v1: {
        checked_at: new Date().toISOString(),
        applied: options.apply,
        source_policy: 'source-backed activity/attraction_query only; no guessed attraction names',
        before_placeholder_count: beforeCount,
        after_placeholder_count: afterCount,
        replacements: repair.replacements,
        next_action: afterCount === 0
          ? 'rerun customer-visible audit and customer_open_contract'
          : 'needs_human_source_review',
      },
    };

    if (repair.repaired && options.apply) {
      const { error: updateError } = await supabaseAdmin
        .from('travel_packages')
        .update({
          itinerary_data: repair.itineraryData,
          audit_report: auditReport,
          updated_at: new Date().toISOString(),
        })
        .eq('id', pkg.id);
      if (updateError) throw new Error(updateError.message);
    }

    results.push({
      id: pkg.id,
      code: pkg.internal_code,
      title: pkg.title,
      beforePlaceholderCount: beforeCount,
      afterPlaceholderCount: afterCount,
      replacements: repair.replacements,
      changed: repair.repaired,
      applied: repair.repaired && options.apply,
      masterRepairs: [...masterRepairs.entries()].map(([id, name]) => ({ id, name })),
      nextAction: afterCount === 0 ? 'customer_open_candidate_recheck' : 'needs_human_source_review',
    });
  }

  const masterResults = options.repairHiddenAttractionMasters
    ? await repairHiddenAttractionMasters(allMasterRepairs, options.apply)
    : [];

  const summary = {
    mode: options.apply ? 'apply' : 'dry-run',
    requestedCodes: options.codes,
    scanned: packages.length,
    changed: results.filter((result) => result.changed).length,
    remainingPlaceholderCount: results.reduce((sum, result) => sum + result.afterPlaceholderCount, 0),
    hiddenMasterRepairs: masterResults,
    results,
  };

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Pending placeholder attraction repair: ${summary.mode}`);
    console.log(`Scanned ${summary.scanned}, changed ${summary.changed}, remaining placeholders ${summary.remainingPlaceholderCount}`);
    for (const result of results) {
      console.log(`- ${result.code}: ${result.beforePlaceholderCount} -> ${result.afterPlaceholderCount}`);
      for (const replacement of result.replacements) {
        console.log(`  ${replacement.before} => ${replacement.after}`);
      }
    }
  }

  if (summary.remainingPlaceholderCount > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
