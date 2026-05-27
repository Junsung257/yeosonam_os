const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');
const envPath = path.join(__dirname, '..', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const [k, ...rest] = line.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data, error } = await sb.from('travel_packages')
    .select('id, title, short_code, destination, duration, status, departure_airport')
    .or('destination.ilike.%후쿠오카%,destination.ilike.%나가사키%,destination.ilike.%사세보%,country.ilike.%일본%');
  if (error) { console.error(error); return; }
  console.log(`후쿠오카/나가사키/사세보/일본 관련 상품: ${data.length}건\n`);
  for (const p of data) {
    console.log(`  [${p.status}] ${p.short_code || '—'} | ${p.title} (${p.duration}일, ${p.destination})`);
  }
})().catch(e => { console.error(e); process.exit(1); });
