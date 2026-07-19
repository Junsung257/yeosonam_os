import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { reEnrichAffectedPackages } from '../src/lib/package-reenrich-on-attraction-change';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env.croncheck.local' });
loadEnv();

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const json = args.includes('--json');
const limit = Number(argValue('--limit', '10000'));

function argValue(name: string, fallback: string): string {
  const found = args.find(arg => arg.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing Supabase env');

const supabase = createClient(url, key, { auth: { persistSession: false } });

type PromotedCandidateRow = {
  candidate_key: string;
  promoted_attraction_id: string | null;
  source_context: Record<string, unknown> | null;
};

function sourcePackageIds(row: PromotedCandidateRow): string[] {
  const ids = row.source_context?.package_ids;
  return Array.isArray(ids)
    ? ids.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];
}

async function fetchRows(): Promise<PromotedCandidateRow[]> {
  const rows: PromotedCandidateRow[] = [];
  const pageSize = 1000;
  for (let from = 0; rows.length < limit; from += pageSize) {
    const to = Math.min(from + pageSize - 1, limit - 1);
    const { data, error } = await supabase
      .from('entity_master_candidates')
      .select('candidate_key,promoted_attraction_id,source_context')
      .eq('promotion_status', 'promoted')
      .not('promoted_attraction_id', 'is', null)
      .range(from, to);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data as PromotedCandidateRow[]);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  const rows = await fetchRows();
  const attractionIds = new Set<string>();
  const packageIds = new Set<string>();
  const candidatesWithPackages: Array<{
    candidate_key: string;
    attraction_id: string;
    package_ids: string[];
  }> = [];

  for (const row of rows) {
    if (!row.promoted_attraction_id) continue;
    const rowPackageIds = sourcePackageIds(row);
    if (rowPackageIds.length === 0) continue;
    attractionIds.add(row.promoted_attraction_id);
    for (const packageId of rowPackageIds) packageIds.add(packageId);
    candidatesWithPackages.push({
      candidate_key: row.candidate_key,
      attraction_id: row.promoted_attraction_id,
      package_ids: rowPackageIds,
    });
  }

  const reEnrich = apply && attractionIds.size > 0 && packageIds.size > 0
    ? await reEnrichAffectedPackages([...attractionIds], {
      packageIds: [...packageIds],
      maxPackages: Math.max(200, packageIds.size),
      forceRevalidate: true,
    })
    : null;

  const output = {
    checked_at: new Date().toISOString(),
    apply,
    scanned: rows.length,
    candidates_with_packages: candidatesWithPackages.length,
    attraction_ids: attractionIds.size,
    package_ids: packageIds.size,
    reEnrich,
    samples: candidatesWithPackages.slice(0, 30),
  };

  if (json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`Scanned ${output.scanned} promoted entity candidates`);
  console.log(`Candidates with packages: ${output.candidates_with_packages}`);
  console.log(`Attractions: ${output.attraction_ids}`);
  console.log(`Packages: ${output.package_ids}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
