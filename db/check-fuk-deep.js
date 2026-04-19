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
  const { data, error } = await sb.from('travel_packages').select('*').in('id', IDS);
  if (error) { console.error(error); return; }
  for (const r of data) {
    console.log('═'.repeat(80));
    console.log(`[${r.short_code}] ${r.title}`);
    console.log('═'.repeat(80));
    const interesting = [
      'destination','airline','flight_info','departure_city','arrival_city',
      'insurance','included_items','excluded_items','highlights',
      'special_notes','notices','notices_parsed','cancel_policy','cancellation_policy',
      'blocked_dates','excluded_dates','surcharges','surcharge_periods',
      'price_dates','itinerary_data'
    ];
    for (const k of interesting) {
      if (r[k] === undefined) continue;
      const v = r[k];
      if (v === null) { console.log(`  ${k}: null`); continue; }
      if (typeof v === 'string') { console.log(`  ${k}: ${v.slice(0, 300)}`); continue; }
      console.log(`  ${k}:`);
      console.log('    ' + JSON.stringify(v, null, 2).split('\n').join('\n    ').slice(0, 2000));
    }
    console.log('\n  [ALL KEYS]:', Object.keys(r).sort().join(', '));
    console.log('');
  }
})();
