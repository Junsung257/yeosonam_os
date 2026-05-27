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
  const { data } = await sb.from('travel_packages').select('*').in('id', IDS);
  for (const r of data) {
    console.log('\n════', r.short_code, r.title);
    console.log('-- product_highlights:', JSON.stringify(r.product_highlights));
    console.log('-- inclusions:', JSON.stringify(r.inclusions));
    console.log('-- excludes:', JSON.stringify(r.excludes));
    console.log('-- departure_airport:', r.departure_airport);
    console.log('-- itinerary_data.days regions:');
    const days = r.itinerary_data?.days || [];
    days.forEach((d, i) => {
      console.log(`   Day${d.day}: regions=${JSON.stringify(d.regions)}`);
    });
    console.log('-- itinerary_data.meta:', JSON.stringify(r.itinerary_data?.meta));
    console.log('-- marketing_copies:', JSON.stringify(r.marketing_copies)?.slice(0,500));
    console.log('-- guide_tip:', r.guide_tip?.slice(0, 300));
    console.log('-- product_summary:', r.product_summary?.slice(0, 300));
  }
})();
