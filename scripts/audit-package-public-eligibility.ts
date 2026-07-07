import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

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

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  return {
    json: args.has('--json'),
    samples: Number(process.argv.find((arg) => arg.startsWith('--samples='))?.split('=')[1] ?? 10),
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
    .select('id,title,destination,status,audit_status,audit_report,updated_at,optional_tours,itinerary_data')
    .in('status', ['active', 'approved'])
    .limit(5000);

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
  }

  const report = {
    checked_at: new Date().toISOString(),
    total_public_status_packages: rows.length,
    openable: openable.length,
    blocked: rows.length - openable.length,
    blocker_counts: blockerCounts,
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
