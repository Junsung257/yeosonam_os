import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local' });
loadEnv();

const args = new Set(process.argv.slice(2));
const json = args.has('--json');
const limit = Number(argValue('--limit', '50'));
const referenced = args.has('--referenced');
const status = argValue('--status', 'active');

function argValue(name: string, fallback: string): string {
  const found = process.argv.find(arg => arg.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

async function main() {
  const { batchAttractionPhotoMatch, runAttractionPhotoMatch } = await import('../src/lib/attraction-photo-match');
  if (referenced) {
    const { supabaseAdmin, isSupabaseConfigured } = await import('../src/lib/supabase');
    if (!isSupabaseConfigured) {
      const output = { mode: 'referenced', status, limit, processed: 0, totalPhotos: 0, reason: 'supabase_not_configured' };
      if (json) console.log(JSON.stringify(output, null, 2));
      else console.log(`[fill-attraction-photos] ${output.reason}`);
      return;
    }

    const { data: packages, error: packageError } = await supabaseAdmin
      .from('travel_packages')
      .select('id, itinerary_data')
      .eq('status', status)
      .not('itinerary_data', 'is', null)
      .limit(1000);
    if (packageError) throw packageError;

    const ids = Array.from(new Set((packages ?? []).flatMap(row => collectAttractionIds(row.itinerary_data)))).slice(0, limit);
    const rows = await fetchAttractionsByIds(ids);
    let processed = 0;
    let totalPhotos = 0;
    for (const row of rows.filter(row => !Array.isArray(row.photos) || row.photos.length === 0)) {
      const photos = await runAttractionPhotoMatch(row.id, {
        keywords: unique([row.name, ...(Array.isArray(row.aliases) ? row.aliases : [])]),
        qid: row.qid ?? null,
        country: row.country,
        region: row.region,
        destination: row.region,
        maxPhotos: 5,
      });
      processed += 1;
      totalPhotos += photos.length;
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    const output = { mode: 'referenced', status, limit, referencedAttractions: ids.length, processed, totalPhotos };
    if (json) console.log(JSON.stringify(output, null, 2));
    else console.log(`[fill-attraction-photos] mode=referenced processed=${processed} totalPhotos=${totalPhotos}`);
    return;
  }

  const result = await batchAttractionPhotoMatch(limit);
  if (json) console.log(JSON.stringify({ limit, ...result }, null, 2));
  else console.log(`[fill-attraction-photos] processed=${result.processed} totalPhotos=${result.totalPhotos}`);
}

function collectAttractionIds(itineraryData: unknown): string[] {
  const days = Array.isArray((itineraryData as { days?: unknown } | null)?.days)
    ? (itineraryData as { days: Array<Record<string, unknown>> }).days
    : [];
  const ids: string[] = [];
  for (const day of days) {
    const schedule = Array.isArray(day.schedule) ? day.schedule as Array<Record<string, unknown>> : [];
    for (const item of schedule) {
      const itemIds = Array.isArray(item.attraction_ids) ? item.attraction_ids : [];
      for (const id of itemIds) {
        if (typeof id === 'string' && id.length > 0) ids.push(id);
      }
    }
  }
  return ids;
}

type AttractionRow = {
  id: string;
  name: string;
  aliases: string[] | null;
  qid?: string | null;
  country: string | null;
  region: string | null;
  photos: unknown[] | null;
};

async function fetchAttractionsByIds(ids: string[]): Promise<AttractionRow[]> {
  if (ids.length === 0) return [];
  const { supabaseAdmin } = await import('../src/lib/supabase');
  const rows: AttractionRow[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    let { data, error } = await supabaseAdmin
      .from('attractions')
      .select('id, name, aliases, qid, country, region, photos')
      .in('id', chunk);
    if (error && /qid/i.test(error.message ?? '')) {
      const retry = await supabaseAdmin
        .from('attractions')
        .select('id, name, aliases, country, region, photos')
        .in('id', chunk);
      data = retry.data?.map(row => ({ ...row, qid: null })) ?? null;
      error = retry.error;
    }
    if (error) throw error;
    rows.push(...((data ?? []) as AttractionRow[]));
  }
  return rows;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map(value => value.replace(/\s+/g, ' ').trim()).filter(Boolean)));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
