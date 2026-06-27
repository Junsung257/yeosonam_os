import { config as loadEnv } from 'dotenv';

import { buildSourceBackedAttractionDescriptions } from '../src/lib/attraction-source-backed-description';

loadEnv({ path: '.env.local' });
loadEnv();

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const json = args.has('--json');
const status = argValue('--status', 'active');
const limit = Number(argValue('--limit', '500'));
const ids = argValue('--ids', '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

function argValue(name: string, fallback: string): string {
  const found = process.argv.find(arg => arg.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

type Ref = {
  id: string;
  activity: string;
};

type AttractionRow = {
  id: string;
  name: string;
  aliases: string[] | null;
  country: string | null;
  region: string | null;
  short_desc: string | null;
  long_desc: string | null;
};

async function main() {
  const { supabaseAdmin, isSupabaseConfigured } = await import('../src/lib/supabase');
  if (!isSupabaseConfigured) throw new Error('Supabase is not configured');

  let query = supabaseAdmin
    .from('travel_packages')
    .select('id, itinerary_data')
    .not('itinerary_data', 'is', null)
    .limit(limit);
  if (ids.length > 0) query = query.in('id', ids);
  else query = query.eq('status', status);

  const { data: packages, error: packageError } = await query;
  if (packageError) throw packageError;

  const refsById = new Map<string, Set<string>>();
  for (const row of packages ?? []) {
    for (const ref of collectRefs(row.itinerary_data)) {
      if (!refsById.has(ref.id)) refsById.set(ref.id, new Set());
      refsById.get(ref.id)?.add(ref.activity);
    }
  }

  const attractionRows = await fetchAttractions([...refsById.keys()]);
  const targets = attractionRows.filter(row => !row.short_desc || !row.long_desc);
  const updates = [];
  for (const row of targets) {
    const descriptions = buildSourceBackedAttractionDescriptions({
      name: row.name,
      aliases: row.aliases,
      examples: [...(refsById.get(row.id) ?? [])],
      region: row.region,
    });
    updates.push({
      id: row.id,
      name: row.name,
      short_desc: descriptions.shortDesc,
      long_desc: descriptions.longDesc,
    });
    if (apply) {
      const { error } = await supabaseAdmin
        .from('attractions')
        .update({
          short_desc: descriptions.shortDesc,
          long_desc: descriptions.longDesc,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      if (error) throw error;
    }
  }

  const output = {
    apply,
    status,
    ids: ids.length,
    scannedReferencedAttractions: refsById.size,
    updated: apply ? updates.length : 0,
    candidates: updates.length,
    examples: updates.slice(0, 20),
  };
  if (json) console.log(JSON.stringify(output, null, 2));
  else console.log(output);
}

function collectRefs(itineraryData: unknown): Ref[] {
  const days = Array.isArray((itineraryData as { days?: unknown } | null)?.days)
    ? (itineraryData as { days: Array<Record<string, unknown>> }).days
    : [];
  const refs: Ref[] = [];
  for (const day of days) {
    const schedule = Array.isArray(day.schedule) ? day.schedule as Array<Record<string, unknown>> : [];
    for (const item of schedule) {
      const activity = typeof item.activity === 'string' ? item.activity : '';
      const ids = Array.isArray(item.attraction_ids) ? item.attraction_ids : [];
      for (const id of ids) {
        if (typeof id === 'string' && id.length > 0) refs.push({ id, activity });
      }
    }
  }
  return refs;
}

async function fetchAttractions(ids: string[]): Promise<AttractionRow[]> {
  if (ids.length === 0) return [];
  const { supabaseAdmin } = await import('../src/lib/supabase');
  const rows: AttractionRow[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const { data, error } = await supabaseAdmin
      .from('attractions')
      .select('id, name, aliases, country, region, short_desc, long_desc')
      .in('id', chunk);
    if (error) throw error;
    rows.push(...((data ?? []) as AttractionRow[]));
  }
  return rows;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
