const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

function loadEnv() {
  const env = {};
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
  const sb = createClient(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const codes = ['PUS-ETC-BOH-05-0001', 'PUS-ETC-BOH-06-0001'];
  const { data, error } = await sb
    .from('travel_packages')
    .select('*')
    .in('internal_code', codes);
  if (error) { console.error(error); process.exit(1); }

  for (const pkg of (data || []).sort((a, b) => a.internal_code.localeCompare(b.internal_code))) {
    const raw = pkg.raw_text || '';
    const dayNums = [...raw.matchAll(/제\s*(\d+)\s*일/g)].map(m => +m[1]);
    console.log('\n==========', pkg.internal_code, '==========');
    console.log('id:', pkg.id);
    console.log('title:', pkg.title);
    console.log('display_title:', pkg.display_title);
    console.log('duration:', pkg.duration, 'itinerary days:', pkg.itinerary_data?.days?.length);
    console.log('price:', pkg.price);
    console.log('excludes:', JSON.stringify(pkg.excludes));
    console.log('inclusions sample:', (pkg.inclusions || []).slice(0, 3));
    console.log('raw len:', raw.length, 'day max:', dayNums.length ? Math.max(...dayNums) : 0);
    console.log('product_summary:', (pkg.product_summary || '').slice(0, 100));
    console.log('audit_status:', pkg.audit_status);
  }
})();
