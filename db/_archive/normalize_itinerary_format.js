/**
 * itinerary_data 포맷 통일: { days: [...] } → [...]
 * 렌더러는 normalizeDays()로 두 포맷 모두 처리하지만, DB 통일로 Zod strict 준수.
 */
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');
const envPath = path.join(__dirname, '..', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const [k, ...rest] = line.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes('--apply');

(async () => {
  const all = [];
  let offset = 0;
  while (true) {
    const { data } = await sb.from('travel_packages').select('id, title, itinerary_data').range(offset, offset + 999);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  console.log(`총 ${all.length}건 상품 스캔`);

  const needs = all.filter(pkg => {
    if (!pkg.itinerary_data) return false;
    if (Array.isArray(pkg.itinerary_data)) return false;
    return typeof pkg.itinerary_data === 'object' && 'days' in pkg.itinerary_data;
  });
  console.log(`변환 대상: ${needs.length}건 (객체 포맷 → 배열)\n`);

  if (!APPLY) {
    console.log('샘플 3건:');
    needs.slice(0, 3).forEach(p => console.log(`  - ${p.title} (days.length=${p.itinerary_data.days?.length || 0})`));
    console.log('\n[DRY-RUN] --apply 로 실제 반영');
    return;
  }

  let ok = 0;
  for (const pkg of needs) {
    const newData = pkg.itinerary_data.days || [];
    // 필수: {meta, highlights, days, ...} 객체의 경우 days만 남기면 meta 손실 위험
    // 그러나 DB의 itinerary_data는 days만 쓰고, 별도 테이블에 meta 있음
    const { error } = await sb.from('travel_packages').update({ itinerary_data: newData }).eq('id', pkg.id);
    if (error) console.error(`❌ ${pkg.title}:`, error.message);
    else ok++;
  }
  console.log(`\n✅ UPDATE ${ok}/${needs.length}건 완료`);
})().catch(e => { console.error(e); process.exit(1); });
