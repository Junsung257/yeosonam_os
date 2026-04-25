/**
 * @file filter_past_dates_20260419.js
 * @description 나가사키 2건 price_dates에서 오늘 이전 날짜 제거 + raw_text_hash 저장 완료 여부 확인.
 *   post_register_audit 경고 중 "과거 출발일 포함"을 해소.
 */
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const [k, ...rest] = line.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const IDS = ['2227e9c4-a8ba-464e-b89e-4b901625fa8e', 'e4a2ae42-d00e-484a-ad78-3785c955448b'];
const TODAY = new Date().toISOString().slice(0, 10);

(async () => {
  console.log(`🗓  과거 출발일 필터 (오늘 이전 < ${TODAY})\n`);
  const { data: rows } = await sb.from('travel_packages')
    .select('id, short_code, price_dates, raw_text, raw_text_hash').in('id', IDS);

  for (const r of rows) {
    const before = (r.price_dates || []).length;
    const filtered = (r.price_dates || []).filter(pd => pd.date >= TODAY);
    const removed = before - filtered.length;

    const update = { price_dates: filtered };
    // raw_text_hash 검증
    if (r.raw_text && !r.raw_text_hash) {
      update.raw_text_hash = crypto.createHash('sha256').update(r.raw_text).digest('hex');
    }

    console.log(`${r.short_code}: price_dates ${before} → ${filtered.length} (${removed}건 제거)`);
    if (update.raw_text_hash) console.log(`  + raw_text_hash 저장: ${update.raw_text_hash.slice(0,16)}...`);

    const { error } = await sb.from('travel_packages').update(update).eq('id', r.id);
    if (error) { console.error('❌', error); process.exit(1); }
  }
  console.log('\n✅ 완료');
})().catch(e => { console.error(e); process.exit(1); });
