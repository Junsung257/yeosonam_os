import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

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
  const id = 'e740822c-df2b-4a58-83de-ea07cc94e23b';
  const { data } = await sb.from('travel_packages').select('raw_text').eq('id', id).single();
  const raw = data?.raw_text ?? '';
  const m = raw.match(/제\s*1\s*일[\s\S]*?(?=제\s*2\s*일|$)/);
  fs.writeFileSync('db/_bohol_day1_raw.txt', m?.[0] ?? 'NOT FOUND', 'utf-8');
  console.log('written', (m?.[0] ?? '').length, 'chars');
})();
