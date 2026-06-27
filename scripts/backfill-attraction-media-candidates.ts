import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

import {
  evaluateAttractionMediaReadiness,
  persistAttractionMediaCandidates,
} from '../src/lib/product-registration/attraction-media-readiness';

loadEnv({ path: '.env.local' });
loadEnv();

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const json = args.has('--json');
const limit = Number(argValue('--limit', '500'));
const status = argValue('--status', '');
const ids = argValue('--ids', '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

function argValue(name: string, fallback: string): string {
  const found = process.argv.find(arg => arg.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

type PackageRow = {
  id: string;
  title: string | null;
  destination: string | null;
  status: string | null;
  itinerary_data: unknown;
};

async function fetchPackages(): Promise<PackageRow[]> {
  let query = supabase
    .from('travel_packages')
    .select('id, title, destination, status, itinerary_data')
    .not('itinerary_data', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (ids.length > 0) query = query.in('id', ids);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as PackageRow[];
}

async function main() {
  const rows = await fetchPackages();
  const details: Array<{
    id: string;
    title: string | null;
    status: string | null;
    destination: string | null;
    candidates: string[];
    upserted: number;
  }> = [];

  let candidateTotal = 0;
  let upsertedTotal = 0;

  for (const row of rows) {
    const readiness = evaluateAttractionMediaReadiness({
      itineraryData: row.itinerary_data,
      includePhotoAudit: false,
    });
    const labels = Array.from(new Set(readiness.unmatchedCandidates.map(candidate => candidate.label)));
    candidateTotal += labels.length;

    let upserted = 0;
    if (apply && labels.length > 0) {
      const result = await persistAttractionMediaCandidates({
        supabase,
        packageId: row.id,
        packageTitle: row.title ?? row.id,
        itineraryData: row.itinerary_data,
        destination: row.destination,
        source: 'backfill-attraction-media-candidates',
      });
      upserted = result.upserted;
      upsertedTotal += upserted;
    }

    if (labels.length > 0) {
      details.push({
        id: row.id,
        title: row.title,
        status: row.status,
        destination: row.destination,
        candidates: labels.slice(0, 20),
        upserted,
      });
    }
  }

  const output = {
    apply,
    ids: ids.length,
    scanned: rows.length,
    packages_with_candidates: details.length,
    candidateTotal,
    upsertedTotal,
    details: details.slice(0, 50),
  };

  if (json) console.log(JSON.stringify(output, null, 2));
  else console.log(output);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
