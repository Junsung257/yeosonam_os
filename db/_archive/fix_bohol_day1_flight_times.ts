/**
 * 보홀 슬림팩 2건 — DAY1 항공 시간 오표기 DB 수리
 * - 미팅/가이드 줄 time 제거
 * - flight_segments arr_day_offset 익일(+1) 보정
 */
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { normalizeItinerary } from '../src/lib/itinerary-normalizer';
import { normalizeFlightSegments } from '../src/lib/parser/normalize-flight-segments';

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

const IDS = ['e740822c-df2b-4a58-83de-ea07cc94e23b', '3646b8bb-9c5f-4a9f-bf11-999ea0c42a32'];

(async () => {
  const env = loadEnv();
  const sb = createClient(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);

  for (const id of IDS) {
    const { data: pkg, error } = await sb.from('travel_packages').select('id, itinerary_data').eq('id', id).single();
    if (error || !pkg) {
      console.error(id, error);
      continue;
    }

    const normalized = normalizeFlightSegments(
      normalizeItinerary(pkg.itinerary_data as Parameters<typeof normalizeItinerary>[0]) as Parameters<typeof normalizeFlightSegments>[0],
    );

    const { error: upErr } = await sb
      .from('travel_packages')
      .update({ itinerary_data: normalized })
      .eq('id', id);

    if (upErr) console.error('update failed', id, upErr);
    else {
      const day1 = normalized?.days?.[0]?.schedule ?? [];
      console.log(id, 'OK', day1.map((s: { time?: string | null; activity?: string | null }) => `[${s.time ?? '-'}] ${(s.activity ?? '').slice(0, 40)}`).join(' | '));
      console.log('  outbound arr_day_offset:', normalized?.flight_segments?.[0]?.arr_day_offset);
    }
  }
})();
