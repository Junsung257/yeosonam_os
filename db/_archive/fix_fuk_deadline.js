/**
 * FUK 골프 2건 ticketing_deadline 수정
 * 오류: 원문 "2026.4.1"은 상품 배포일인데 발권기한으로 넣어 즉시 만료 처리됨.
 * 수정: ticketing_deadline = null (이 상품은 항공 블록 아니므로 특정 기한 없음)
 */
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
  const { data, error } = await sb.from('travel_packages')
    .update({ ticketing_deadline: null })
    .in('id', IDS)
    .select('id, title, short_code, status, ticketing_deadline');
  if (error) { console.error(error); return; }
  console.log('✅ ticketing_deadline → null 수정 완료:\n');
  for (const r of data) {
    console.log(`  [${r.status}] ${r.short_code} | ${r.title}`);
    console.log(`    ticketing_deadline: ${r.ticketing_deadline}`);
  }
  console.log('\n이제 /admin/packages 에서 정상 표시됩니다 (만료 필터 통과).');
})().catch(e => { console.error(e); process.exit(1); });
