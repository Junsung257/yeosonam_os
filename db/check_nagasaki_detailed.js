const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');
const envPath = path.join(__dirname, '..', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const [k, ...rest] = line.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const IDS = ['2227e9c4-a8ba-464e-b89e-4b901625fa8e', 'e4a2ae42-d00e-484a-ad78-3785c955448b'];
(async () => {
  // itinerary_data는 JSONB이므로 접근 가능
  const { data, error } = await sb.from('travel_packages')
    .select('id,title,destination,itinerary_data,notices_parsed,blocked_dates,surcharge_periods,special_notes,inclusions')
    .in('id', IDS);
  if (error) { console.error('❌', error); return; }
  for (const pkg of data) {
    console.log(`\n═══ ${pkg.title} (${pkg.id.slice(0,8)}) ═══`);
    console.log(`destination: ${pkg.destination}`);
    console.log(`inclusions: ${JSON.stringify(pkg.inclusions)}`);
    console.log(`notices_parsed 샘플: ${JSON.stringify((pkg.notices_parsed || []).slice(0,1))}`);
    console.log(`blocked_dates: ${JSON.stringify(pkg.blocked_dates)}`);
    console.log(`surcharge_periods: ${JSON.stringify(pkg.surcharge_periods)}`);
    if (pkg.itinerary_data?.days && pkg.itinerary_data.days.length > 1) {
      const day2 = pkg.itinerary_data.days[1];
      console.log(`2일차 regions: ${JSON.stringify(day2?.regions || [])}`);
      console.log(`2일차 meal: ${JSON.stringify(day2?.meal)}`);
    }
    if (pkg.special_notes) {
      console.log(`special_notes 첫500자: ${pkg.special_notes.slice(0,500)}`);
    }
  }
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
