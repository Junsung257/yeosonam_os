import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

loadEnv({ path: '.env.local' });
loadEnv();

const args = new Set(process.argv.slice(2));
const json = args.has('--json');
const limit = Number(argValue('--limit', '100'));
const status = argValue('--status', 'active');

function argValue(name: string, fallback: string): string {
  const found = process.argv.find(arg => arg.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing Supabase env');

const supabase = createClient(url, key, { auth: { persistSession: false } });

type PackageRow = {
  id: string;
  title: string | null;
  status: string | null;
  destination: string | null;
  itinerary_data: unknown;
};

function collectAttractionRefs(itineraryData: unknown): Array<{
  day: number | null;
  activity: string;
  attractionId: string;
}> {
  const root = itineraryData as { days?: unknown } | null;
  const days = Array.isArray(root?.days) ? root.days as Array<Record<string, unknown>> : [];
  const refs: Array<{ day: number | null; activity: string; attractionId: string }> = [];
  for (const day of days) {
    const dayNumber = typeof day.day === 'number' ? day.day : null;
    const schedule = Array.isArray(day.schedule) ? day.schedule as Array<Record<string, unknown>> : [];
    for (const item of schedule) {
      const activity = typeof item.activity === 'string' ? item.activity : '';
      const ids = Array.isArray(item.attraction_ids) ? item.attraction_ids : [];
      for (const id of ids) {
        if (typeof id === 'string' && id) refs.push({ day: dayNumber, activity, attractionId: id });
      }
    }
  }
  return refs;
}

async function main() {
  let query = supabase
    .from('travel_packages')
    .select('id, title, status, destination, itinerary_data')
    .not('itinerary_data', 'is', null)
    .limit(limit);
  if (status !== 'all') query = query.eq('status', status);

  const { data: packages, error } = await query;
  if (error) throw error;

  const rows = (packages ?? []) as PackageRow[];
  const refsByPackage = rows.map(row => ({ row, refs: collectAttractionRefs(row.itinerary_data) }));
  const ids = Array.from(new Set(refsByPackage.flatMap(item => item.refs.map(ref => ref.attractionId))));

  const attractionMap = new Map<string, { id: string; name: string | null; photos: unknown[] }>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    if (chunk.length === 0) continue;
    const { data, error: attractionError } = await supabase
      .from('attractions')
      .select('id, name, photos')
      .in('id', chunk);
    if (attractionError) throw attractionError;
    for (const attraction of (data ?? []) as Array<{ id: string; name: string | null; photos: unknown }>) {
      attractionMap.set(attraction.id, {
        id: attraction.id,
        name: attraction.name,
        photos: Array.isArray(attraction.photos) ? attraction.photos : [],
      });
    }
  }

  const details = refsByPackage.map(({ row, refs }) => {
    const missing = refs.filter(ref => (attractionMap.get(ref.attractionId)?.photos.length ?? 0) === 0);
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      destination: row.destination,
      attraction_refs: refs.length,
      refs_with_photos: refs.length - missing.length,
      photo_coverage: refs.length > 0 ? Number((((refs.length - missing.length) / refs.length) * 100).toFixed(1)) : null,
      missing: missing.slice(0, 20).map(ref => ({
        day: ref.day,
        activity: ref.activity,
        attraction_id: ref.attractionId,
        attraction_name: attractionMap.get(ref.attractionId)?.name ?? null,
      })),
    };
  });

  const totalRefs = details.reduce((sum, row) => sum + row.attraction_refs, 0);
  const totalWithPhotos = details.reduce((sum, row) => sum + row.refs_with_photos, 0);
  const output = {
    scanned_packages: rows.length,
    packages_with_attraction_refs: details.filter(row => row.attraction_refs > 0).length,
    total_attraction_refs: totalRefs,
    refs_with_photos: totalWithPhotos,
    photo_coverage: totalRefs > 0 ? Number(((totalWithPhotos / totalRefs) * 100).toFixed(1)) : null,
    details: details.filter(row => row.attraction_refs > 0).slice(0, 50),
  };

  if (json) console.log(JSON.stringify(output, null, 2));
  else console.log(output);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
