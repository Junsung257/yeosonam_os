import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { renderPackage } from '../src/lib/render-contract';

function loadEnv() {
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync('.env.local', 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[t.slice(0, eq).trim()] = v;
  }
  return env;
}

(async () => {
  const env = loadEnv();
  const sb = createClient(
    env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL!,
    env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const ids = ['e740822c-df2b-4a58-83de-ea07cc94e23b', '3646b8bb-9c5f-4a9f-bf11-999ea0c42a32'];
  const { data, error } = await sb.from('travel_packages').select('*').in('id', ids);
  if (error) { console.error(error); process.exit(1); }

  for (const pkg of data || []) {
    console.log('\n==========', pkg.id, '==========');
    console.log('title:', pkg.display_title || pkg.title);
    const day1 = pkg.itinerary_data?.days?.[0];
    console.log('\n--- RAW DB day1.schedule ---');
    console.log(JSON.stringify(day1?.schedule, null, 2));
    console.log('\n--- flight_segments ---');
    console.log(JSON.stringify(pkg.itinerary_data?.flight_segments, null, 2));
    console.log('\n--- meta ---');
    console.log(JSON.stringify(pkg.itinerary_data?.meta, null, 2));
    const view = renderPackage(pkg);
    console.log('\n--- render-contract day1 ---');
    console.log(JSON.stringify({ flight: view.days[0]?.flight, schedule: view.days[0]?.schedule }, null, 2));
    console.log('\n--- flightHeader.outbound ---');
    console.log(JSON.stringify(view.flightHeader.outbound, null, 2));

    console.log('\n--- ALL DAYS summary ---');
    for (const d of pkg.itinerary_data?.days ?? []) {
      console.log(`DAY ${d.day}:`, (d.schedule ?? []).map((s: { time?: string; type?: string; activity?: string }) =>
        `[${s.time ?? '-'}] ${s.type ?? 'normal'} ${(s.activity ?? '').slice(0, 50)}`).join(' | '));
    }
  }
})();
