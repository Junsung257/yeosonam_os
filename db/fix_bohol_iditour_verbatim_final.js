/**
 * 아이디투어 보홀 — 최종 verbatim 정정 (사장님 새 방향)
 *
 * 결정 (2026-04-27):
 *   - schedule.activity = 원문 verbatim (랜드사 표기 그대로)
 *   - optional_tours[].note = 원문 일정 verbatim (note 는 일정 부연)
 *   - product_summary = 마케팅 카피 → SSOT 정상 표기 유지 (안경원숭이·초콜릿힐)
 *   - attractions 매칭은 aliases 로 처리 (별도 인프라)
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const env = {};
fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf-8')
  .split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const IDS_4D6 = [
  '396f91f0-0287-4ea1-9d9b-7627b3597469',
  'ecb62ece-d118-4dc3-8ac2-df4a407c4715',
  '4e4d085f-b392-48e0-8eee-3a6cb97ae312',
];
const ALL_IDS = [
  'c334c6f3-5121-4cac-a8b5-e1ab3dca8a7d',
  'e5bb7479-da1b-4379-8a7e-b40daf1faca8',
  '16ca09f9-d2f9-40c2-ad5b-1f65877fb59b',
  ...IDS_4D6,
];

const D4_FROM = '▶보홀 데이투어 (안경원숭이·초콜릿힐·멘메이드포레스트)';
const D4_TO   = '▶보홀 데이투어 (타리스어원숭이.초콜렛힐.멘메이드포레스트)'; // 원문 verbatim (점, 원문 표기)

const OPT_NOTE_FROM = '2인 이상 · 안경원숭이·초콜릿힐·멘메이드포레스트';
const OPT_NOTE_TO   = '2인 이상 · 타리스어원숭이.초콜렛힐.멘메이드포레스트'; // 원문 verbatim

(async () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  최종 verbatim 정정 (schedule + opt_note 만)');
  console.log('  product_summary 는 SSOT 정상 표기 유지');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let total = 0;
  for (const id of ALL_IDS) {
    const isLong = IDS_4D6.includes(id);
    const { data: rows } = await sb.from('travel_packages')
      .select('id, short_code, title, itinerary_data, optional_tours').eq('id', id).limit(1);
    const pkg = rows?.[0];
    if (!pkg) continue;

    let changed = 0;
    const itin = JSON.parse(JSON.stringify(pkg.itinerary_data || {}));

    // D4 schedule (4박6일 only)
    if (isLong) {
      for (const day of (itin.days || [])) {
        for (const item of (day.schedule || [])) {
          if (item.activity === D4_FROM) { item.activity = D4_TO; changed++; }
        }
      }
    }

    // optional_tours[보홀 데이투어].note (모두)
    const opt = JSON.parse(JSON.stringify(pkg.optional_tours || []));
    for (const t of opt) {
      if (t?.name === '보홀 데이투어' && t?.note === OPT_NOTE_FROM) { t.note = OPT_NOTE_TO; changed++; }
    }

    if (changed === 0) {
      console.log(`  ${pkg.short_code}: 변경 없음`);
      continue;
    }

    const { error } = await sb.from('travel_packages')
      .update({ itinerary_data: itin, optional_tours: opt }).eq('id', id);
    if (error) throw error;
    console.log(`✅ ${pkg.short_code} | ${pkg.title} — ${changed}건 verbatim 환원`);
    total += changed;
  }
  console.log(`\n📊 총 ${total}건 정정 완료\n`);

  // 검증
  const { data: verify } = await sb.from('travel_packages')
    .select('short_code, itinerary_data, optional_tours, product_summary').in('id', ALL_IDS).order('short_code');
  console.log('━━━ 정정 후 ━━━');
  for (const p of (verify || [])) {
    const days = p.itinerary_data?.days || [];
    const d4 = days[3]?.schedule?.[1]?.activity || '(N/A)';
    const opt = (p.optional_tours || []).find(t => t?.name === '보홀 데이투어');
    const sumIdx = (p.product_summary || '').indexOf('코스');
    const sumSnip = sumIdx > 0 ? p.product_summary.slice(Math.max(0, sumIdx - 18), sumIdx + 8) : '(없음)';
    console.log(`${p.short_code}`);
    console.log(`   D4 활동(원문)     : ${d4}`);
    console.log(`   opt note(원문)    : ${opt?.note || '(none)'}`);
    console.log(`   summary(SSOT 표기): …${sumSnip}…\n`);
  }
})();
