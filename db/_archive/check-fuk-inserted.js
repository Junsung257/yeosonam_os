const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const [k, ...rest] = line.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const IDS = ['2227e9c4-a8ba-464e-b89e-4b901625fa8e', 'e4a2ae42-d00e-484a-ad78-3785c955448b'];
(async () => {
  const { data, error } = await sb.from('travel_packages').select('id, title, short_code, status, destination, land_operator_id, price, created_at').in('id', IDS);
  if (error) { console.error(error); return; }
  console.log('DB 실제 상태:\n');
  for (const r of data) {
    console.log(`  [${r.status}] ${r.short_code} | ${r.title}`);
    console.log(`    id: ${r.id}`);
    console.log(`    dest: ${r.destination} | land_op: ${r.land_operator_id} | price: ₩${r.price?.toLocaleString()} | created: ${r.created_at}\n`);
  }
})();
