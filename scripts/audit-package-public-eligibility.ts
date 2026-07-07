import dotenv from 'dotenv';

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
    statusList: argValue('status', 'active,approved')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
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
  const blockerCounts: Record<string, number> = {};
  const samples: Array<{
    id: string;
    title: string | null;
    destination: string | null;
    audit_status: string | null;
    blockers: string[];
  }> = [];

  const openable = rows.filter(isCustomerPubliclyOpenable);
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
    const blockers = getPackagePublicEligibilityBlockers(row);
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
      const checkedAt = new Date().toISOString();
      const blockerCodes = blockers.map((blocker) => blocker.code);
      const previousReport = row.audit_report && typeof row.audit_report === 'object' && !Array.isArray(row.audit_report)
        ? row.audit_report as Record<string, unknown>
        : {};
      const auditReport = {
        ...previousReport,
        public_eligibility_demotion: {
          source: 'audit-package-public-eligibility',
          checked_at: checkedAt,
          previous_status: row.status,
          blockers: blockers.map((blocker) => ({
            code: blocker.code,
            message: blocker.message,
          })),
          next_action: 'repair_customer_open_contract_and_mobile_proof_before_publication',
        },
      };
      const { error: packageError } = await supabaseAdmin
        .from('travel_packages')
        .update({
          status: 'pending_review',
          audit_status: 'blocked',
          audit_report: auditReport,
          audit_checked_at: checkedAt,
          updated_at: checkedAt,
        })
        .eq('id', row.id);
      if (packageError) {
        demotions.push({
          id: row.id,
          internal_code: row.internal_code,
          title: row.title,
          destination: row.destination,
          previous_status: row.status,
          new_status: 'pending_review',
          product_status_updated: false,
          blockers: blockerCodes,
          error: packageError.message,
        });
        continue;
      }

      let productStatusUpdated = false;
      if (row.internal_code) {
        const { error: productError } = await supabaseAdmin
          .from('products')
          .update({ status: 'REVIEW_NEEDED', updated_at: checkedAt })
          .eq('internal_code', row.internal_code);
        productStatusUpdated = !productError;
      }
      demotions.push({
        id: row.id,
        internal_code: row.internal_code,
        title: row.title,
        destination: row.destination,
        previous_status: row.status,
        new_status: 'pending_review',
        product_status_updated: productStatusUpdated,
        blockers: blockerCodes,
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

  console.log(`Checked ${report.total_public_status_packages} active/approved packages`);
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
