import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { parseDayTable } from '../src/lib/parser/deterministic/day-table';

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
  const sb = createClient(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await sb.from('travel_packages').select('raw_text').eq('id', 'e740822c-df2b-4a58-83de-ea07cc94e23b').single();
  const r = parseDayTable(data!.raw_text);
  console.log(JSON.stringify(r.days[0]?.schedule, null, 2));
})();
