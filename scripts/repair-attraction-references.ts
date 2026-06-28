import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { enrichItineraryWithAttractionReferences, type ItineraryDataLike } from '@/lib/itinerary-attraction-enricher';
import type { AttractionData } from '@/lib/attraction-matcher';

for (const file of ['.env.local', '.env.croncheck.local', '.env.prod', '.env']) {
  const fullPath = path.join(process.cwd(), file);
  if (fs.existsSync(fullPath)) dotenv.config({ path: fullPath, quiet: true });
}

const apply = process.argv.includes('--apply');
const codeFilter = (process.argv.find(arg => arg.startsWith('--codes='))?.split('=')[1] ?? '')
  .split(',')
  .map(code => code.trim())
  .filter(Boolean);
const statusFilter = (process.argv.find(arg => arg.startsWith('--status='))?.split('=')[1] ?? '')
  .split(',')
  .map(status => status.trim())
  .filter(Boolean);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) throw new Error('Missing Supabase environment variables');

const supabase = createClient(url, key, { auth: { persistSession: false } });

type PackageRow = {
  id: string;
  title: string | null;
  internal_code: string | null;
  status: string | null;
  destination: string | null;
  itinerary_data: ItineraryDataLike | null;
};

function attractionIdSet(itineraryData: ItineraryDataLike | null): Set<string> {
  const ids = new Set<string>();
  for (const day of itineraryData?.days ?? []) {
    for (const item of day.schedule ?? []) {
      const itemIds = Array.isArray(item.attraction_ids) ? item.attraction_ids : [];
      for (const id of itemIds) if (typeof id === 'string' && id) ids.add(id);
    }
  }
  return ids;
}

function diffIds(before: Set<string>, after: Set<string>): string[] {
  return [...after].filter(id => !before.has(id));
}

async function fetchAllActiveAttractions(): Promise<AttractionData[]> {
  const out: AttractionData[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('attractions')
      .select('id,name,aliases,region,country,short_desc,badge_type,emoji,category,mrt_gid')
      .eq('is_active', true)
      .range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as AttractionData[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function fetchPackages(): Promise<PackageRow[]> {
  let query = supabase
    .from('travel_packages')
    .select('id,title,internal_code,status,destination,itinerary_data')
    .order('updated_at', { ascending: false });

  if (codeFilter.length > 0) {
    query = query.in('internal_code', codeFilter);
  } else if (statusFilter.length > 0) {
    query = query.in('status', statusFilter);
  } else {
    query = query
      .eq('status', 'active')
      .or('title.ilike.%백두%,title.ilike.%연길%,destination.ilike.%백두%,destination.ilike.%연길%');
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as PackageRow[];
}

async function main() {
  const attractions = await fetchAllActiveAttractions();
  const rows = await fetchPackages();
  const changed: Array<{
    id: string;
    code: string | null;
    title: string | null;
    status: string | null;
    added_ids: string[];
    matched_names: string[];
  }> = [];

  for (const row of rows) {
    const before = attractionIdSet(row.itinerary_data);
    const enriched = enrichItineraryWithAttractionReferences(row.itinerary_data, attractions, row.destination ?? undefined);
    const after = attractionIdSet(enriched.itineraryData);
    const added = diffIds(before, after);
    if (added.length === 0) continue;
    changed.push({
      id: row.id,
      code: row.internal_code,
      title: row.title,
      status: row.status,
      added_ids: added,
      matched_names: enriched.matchedCanonicalNames,
    });
    if (apply) {
      const { error: updateError } = await supabase
        .from('travel_packages')
        .update({ itinerary_data: enriched.itineraryData, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      if (updateError) throw updateError;
    }
  }

  console.log(JSON.stringify({
    apply,
    active_attractions: attractions.length,
    code_filter: codeFilter,
    status_filter: statusFilter,
    scanned: rows.length,
    changed: changed.length,
    rows: changed,
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
