import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { mergeRawTextMealEvidence, normalizeStructuredItineraryEntities } from '@/lib/itinerary-structured-entities';

for (const file of ['.env.local', '.env']) {
  const fullPath = path.join(process.cwd(), file);
  if (fs.existsSync(fullPath)) dotenv.config({ path: fullPath, quiet: true });
}

const apply = process.argv.includes('--apply');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) throw new Error('Missing Supabase environment variables');

const supabase = createClient(url, key);

type PackageRow = {
  id: string;
  title: string | null;
  destination: string | null;
  raw_text: string | null;
  itinerary_data: Record<string, unknown> | null;
};

function collectScheduleTokens(itineraryData: Record<string, unknown> | null): string[] {
  const days = Array.isArray(itineraryData?.days) ? itineraryData.days as Array<Record<string, unknown>> : [];
  const out: string[] = [];
  for (const day of days) {
    const schedule = Array.isArray(day.schedule) ? day.schedule as Array<Record<string, unknown>> : [];
    for (const item of schedule) {
      const activity = typeof item.activity === 'string' ? item.activity : '';
      const kind = typeof item.entity_kind === 'string' ? item.entity_kind : '';
      const type = typeof item.type === 'string' ? item.type : '';
      if (kind === 'meal' || kind === 'hotel_stay' || type === 'meal') out.push(activity);
      if (/(?:호텔\s*)?조식\s*후|중식\s*후|석식\s*후/.test(activity)) out.push(activity);
      if (type === 'hotel' && /(?:HOTEL|hotel|호텔).*(?:동급|\([^)]+성[^)]*\))/.test(activity) && !/(?:온천욕|체험|특전|상당)/.test(activity)) {
        out.push(activity);
      }
    }
  }
  return out;
}

async function main() {
  const { data, error } = await supabase
    .from('travel_packages')
    .select('id,title,destination,raw_text,itinerary_data')
    .eq('status', 'active')
    .or('title.ilike.%백두산%,title.ilike.%연길%,destination.ilike.%백두산%,destination.ilike.%연길%');

  if (error) throw error;

  const rows = (data ?? []) as PackageRow[];
  const changed: Array<{ id: string; title: string | null; before: string[]; after: string[] }> = [];

  for (const row of rows) {
    const before = collectScheduleTokens(row.itinerary_data);
    const normalized = mergeRawTextMealEvidence(
      normalizeStructuredItineraryEntities(row.itinerary_data as never),
      row.raw_text,
    ) as Record<string, unknown> | null;
    const after = collectScheduleTokens(normalized);
    if (before.length === 0 && JSON.stringify(row.itinerary_data) === JSON.stringify(normalized)) continue;
    changed.push({ id: row.id, title: row.title, before, after });
    if (apply) {
      const { error: updateError } = await supabase
        .from('travel_packages')
        .update({ itinerary_data: normalized })
        .eq('id', row.id);
      if (updateError) throw updateError;
    }
  }

  console.log(JSON.stringify({
    apply,
    scanned: rows.length,
    changed: changed.length,
    rows: changed,
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
