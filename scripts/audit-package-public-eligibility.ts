import dotenv from 'dotenv';

import { CUSTOMER_VISIBLE_STATUSES } from '../src/lib/visibility-status';
import { evaluateEntityMasterCandidatePublicGate } from '../src/lib/entity-master-candidate-public-gate';

dotenv.config({ path: '.env.local' });

type PackageRow = {
  id: string;
  internal_code: string | null;
  title: string | null;
  destination: string | null;
  status: string | null;
  audit_status: string | null;
  audit_report: unknown;
  updated_at: string | null;
  optional_tours: unknown;
  itinerary_data: unknown;
};

function parseArgs() {
  const rawArgs = process.argv.slice(2);
  const args = new Set(rawArgs);
  const argValue = (name: string, fallback: string) => {
    const prefix = `--${name}=`;
    const found = rawArgs.find((arg) => arg.startsWith(prefix));
    return found ? found.slice(prefix.length) : fallback;
  };
  return {
    demoteUnsafePublic: args.has('--demote-unsafe-public'),
    json: args.has('--json'),
    limit: Number(argValue('limit', '5000')),
    samples: Number(argValue('samples', '10')),
    statusList: argValue('status', CUSTOMER_VISIBLE_STATUSES.join(','))
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

async function loadUnresolvedEntityCandidateMap(
  supabaseAdmin: Awaited<typeof import('../src/lib/supabase')>['supabaseAdmin'],
  packageIds: string[],
): Promise<Map<string, { hard: number; total: number; attractionWarnings: number; needsReview: number }>> {
  const packageIdSet = new Set(packageIds);
  const result = new Map<string, { hard: number; total: number; attractionWarnings: number; needsReview: number }>();

  if (packageIdSet.size === 0) return result;

  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('entity_master_candidates')
      .select('category,promotion_status,auto_action,auto_verification_status,source_context')
      .range(from, from + 999);
    if (error) throw error;
    for (const candidate of data ?? []) {
      const decision = evaluateEntityMasterCandidatePublicGate(candidate);
      if (!decision.unresolved) continue;
      const candidatePackageIds = Array.isArray(candidate.source_context?.package_ids)
        ? [...new Set(candidate.source_context.package_ids.map(String))] as string[]
        : [];
      for (const packageId of candidatePackageIds) {
        if (!packageIdSet.has(packageId)) continue;
        const current = result.get(packageId) ?? { hard: 0, total: 0, attractionWarnings: 0, needsReview: 0 };
        current.total++;
        if (decision.hardBlocker) current.hard++;
        if (decision.warning && candidate.category === 'attraction') current.attractionWarnings++;
        if (candidate.promotion_status === 'needs_review') current.needsReview++;
        result.set(packageId, current);
      }
    }
    if (!data || data.length < 1000) break;
  }

  return result;
}

async function main() {
  const [{ supabaseAdmin, isSupabaseConfigured }, eligibility] = await Promise.all([
    import('../src/lib/supabase'),
    import('../src/lib/package-public-eligibility'),
  ]);
  const { getPackagePublicEligibilityBlockers, isCustomerPubliclyOpenable } = eligibility;
  const options = parseArgs();
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured. Load .env.local before running this audit.');
  }

  const { data, error } = await supabaseAdmin
    .from('travel_packages')
    .select('id,internal_code,title,destination,status,audit_status,audit_report,updated_at,optional_tours,itinerary_data')
    .in('status', options.statusList)
    .limit(options.limit);

  if (error) throw error;

  const rows = (data ?? []) as PackageRow[];
  const unresolvedEntityCandidateMap = await loadUnresolvedEntityCandidateMap(
    supabaseAdmin,
    rows.map((row) => row.id),
  );
  const blockerCounts: Record<string, number> = {};
  const samples: Array<{
    id: string;
    title: string | null;
    destination: string | null;
    audit_status: string | null;
    blockers: string[];
  }> = [];

  const blockersFor = (row: PackageRow) => {
    const blockers = getPackagePublicEligibilityBlockers(row);
    const unresolved = unresolvedEntityCandidateMap.get(row.id);
    if (unresolved && unresolved.hard > 0) {
      blockers.push({
        code: 'entity_master_candidate_unresolved',
        message: `entity_master_candidates has unresolved customer disclosure candidates: hard=${unresolved.hard}, total=${unresolved.total}, attraction_warnings=${unresolved.attractionWarnings}, needs_review=${unresolved.needsReview}`,
      });
    }
    return blockers;
  };

  const openable = rows.filter((row) => blockersFor(row).length === 0);
  const demotions: Array<{
    id: string;
    internal_code: string | null;
    title: string | null;
    destination: string | null;
    previous_status: string | null;
    new_status: string;
    product_status_updated: boolean;
    blockers: string[];
    error?: string;
  }> = [];
  for (const row of rows) {
    const blockers = blockersFor(row);
    if (blockers.length === 0) continue;
    blockers.forEach((blocker) => increment(blockerCounts, blocker.code));
    if (samples.length < options.samples) {
      samples.push({
        id: row.id,
        title: row.title,
        destination: row.destination,
        audit_status: row.audit_status,
        blockers: blockers.map((blocker) => blocker.code),
      });
    }
    if (options.demoteUnsafePublic) {
      const blockerCodes = blockers.map((blocker) => blocker.code);
      demotions.push({
        id: row.id,
        internal_code: row.internal_code,
        title: row.title,
        destination: row.destination,
        previous_status: row.status,
        new_status: 'pending_review',
        product_status_updated: false,
        blockers: blockerCodes,
        error: 'LEGACY_PUBLIC_ELIGIBILITY_DEMOTION_RETIRED_USE_KILL_SWITCH_OR_CORRECTION_REVISION',
      });
    }
  }

  const report = {
    checked_at: new Date().toISOString(),
    total_public_status_packages: rows.length,
    openable: openable.length,
    blocked: rows.length - openable.length,
    blocker_counts: blockerCounts,
    demote_unsafe_public: options.demoteUnsafePublic,
    demoted: demotions.filter((row) => !row.error).length,
    demotion_errors: demotions.filter((row) => row.error).length,
    demotions,
    samples,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Checked ${report.total_public_status_packages} customer-visible status packages`);
  console.log(`Openable: ${report.openable}`);
  console.log(`Blocked: ${report.blocked}`);
  console.log('Blockers:');
  Object.entries(blockerCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([code, count]) => console.log(`- ${code}: ${count}`));
  console.log('\nSamples:');
  samples.forEach((sample) => {
    console.log(`- ${sample.id} | ${sample.destination ?? '-'} | ${sample.title ?? '-'} | ${sample.blockers.join(', ')}`);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
