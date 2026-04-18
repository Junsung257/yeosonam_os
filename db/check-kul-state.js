/**
 * 쿠알라 상품 현재 DB 상태 확인 (읽기 전용)
 */
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [k, ...rest] = line.split('=');
    if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

(async () => {
  const { data: pkgs, error } = await sb
    .from('travel_packages')
    .select('id, title, duration, departure_days, itinerary_data')
    .ilike('destination', '%쿠알라%');
  if (error) { console.error(error); process.exit(1); }

  for (const pkg of pkgs) {
    console.log(`\n═══════ ${pkg.title} ═══════`);
    console.log(`  id: ${pkg.id}`);
    console.log(`  duration: ${pkg.duration}`);
    console.log(`  departure_days: ${JSON.stringify(pkg.departure_days)}`);
    const days = Array.isArray(pkg.itinerary_data) ? pkg.itinerary_data : (pkg.itinerary_data?.days || []);
    for (const day of days) {
      console.log(`\n  DAY ${day.day}:`);
      for (const s of (day.schedule || [])) {
        const icon = s.type === 'flight' ? '✈️' : s.type === 'hotel' ? '🏨' : s.type === 'optional' ? '💎' : '•';
        console.log(`    ${icon} [${s.type || 'normal'}] ${s.activity}`);
      }
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
