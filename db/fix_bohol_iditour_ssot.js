/**
 * 아이디투어 보홀 6 패키지 — attractions DB SSOT 기준 재정정
 *
 * 기준: attractions 테이블 등록 표기를 SSOT 로 적용
 *   - "타리스어원숭이"     → "안경원숭이"   (DB name=안경원숭이, alias=Philippine Tarsier Sanctuary)
 *   - "초콜렛힐"           → "초콜릿힐"      (DB name=초콜릿힐)
 *   - "사왕 재래시장"      → 그대로         (DB 일치)
 *   - "성어거스틴성당"     → 그대로 (verbatim) + unmatched 큐 적재 (사장님 alias 검토)
 *   - "멘메이드포레스트"   → 그대로 (verbatim) + unmatched 큐 적재
 *
 * 이전 정정의 잘못된 부분 되돌림:
 *   - "타리스어원숭이·초콜렛힐·멘메이드포레스트" (verbatim 강요) → "안경원숭이·초콜릿힐·멘메이드포레스트" (SSOT)
 *   - "사왕 재래시장+성어거스틴성당" 은 그대로 둠 (원문 + 보존)
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envPath = path.resolve(__dirname, '..', '.env.local');
const env = {};
fs.readFileSync(envPath, 'utf-8').split('\n').forEach(l => {
  const [k, ...v] = l.split('=');
  if (k) env[k.trim()] = v.join('=').trim();
});
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const IDS_4D6 = [
  '396f91f0-0287-4ea1-9d9b-7627b3597469', // ID-BHO-06-01
  'ecb62ece-d118-4dc3-8ac2-df4a407c4715', // ID-BHO-06-02
  '4e4d085f-b392-48e0-8eee-3a6cb97ae312', // ID-BHO-06-03
];
const ALL_IDS = [
  'c334c6f3-5121-4cac-a8b5-e1ab3dca8a7d',
  'e5bb7479-da1b-4379-8a7e-b40daf1faca8',
  '16ca09f9-d2f9-40c2-ad5b-1f65877fb59b',
  ...IDS_4D6,
];

// schedule activity SSOT 정정 — D4 (4박6일 only)
const D4_FROM = '▶보홀 데이투어 (타리스어원숭이·초콜렛힐·멘메이드포레스트)';
const D4_TO   = '▶보홀 데이투어 (안경원숭이·초콜릿힐·멘메이드포레스트)';

// optional_tours[보홀 데이투어].note (모든 패키지)
const OPT_NOTE_FROM = '2인 이상 · 타리스어원숭이·초콜렛힐·멘메이드포레스트';
const OPT_NOTE_TO   = '2인 이상 · 안경원숭이·초콜릿힐·멘메이드포레스트';

// product_summary (4박6일 only)
const SUMMARY_FROM = '타리스어원숭이·초콜렛힐';
const SUMMARY_TO   = '안경원숭이·초콜릿힐';

async function fixOne(id, isLong) {
  const { data: rows, error: selErr } = await sb
    .from('travel_packages')
    .select('id, short_code, title, itinerary_data, product_summary, optional_tours')
    .eq('id', id)
    .limit(1);
  if (selErr) throw selErr;
  const pkg = rows?.[0];
  if (!pkg) { console.log(`⚠️  ${id} not found`); return { id, changed: 0 }; }

  let changed = 0;

  // 1. itinerary_data D4 schedule (4박6일만)
  const itin = JSON.parse(JSON.stringify(pkg.itinerary_data || {}));
  if (isLong) {
    for (const day of (itin.days || [])) {
      for (const item of (day.schedule || [])) {
        if (item.activity === D4_FROM) {
          item.activity = D4_TO;
          changed++;
        }
      }
    }
  }

  // 2. product_summary (4박6일만)
  let nextSummary = pkg.product_summary;
  if (isLong && pkg.product_summary && pkg.product_summary.includes(SUMMARY_FROM)) {
    nextSummary = pkg.product_summary.split(SUMMARY_FROM).join(SUMMARY_TO);
    if (nextSummary !== pkg.product_summary) changed++;
  }

  // 3. optional_tours[보홀 데이투어].note (모든 패키지)
  const nextOptional = JSON.parse(JSON.stringify(pkg.optional_tours || []));
  for (const t of nextOptional) {
    if (t?.name === '보홀 데이투어' && t?.note === OPT_NOTE_FROM) {
      t.note = OPT_NOTE_TO;
      changed++;
    }
  }

  if (changed === 0) {
    console.log(`  ${pkg.short_code}: 변경 없음`);
    return { id, changed: 0 };
  }

  const { error: updErr } = await sb
    .from('travel_packages')
    .update({
      itinerary_data: itin,
      product_summary: nextSummary,
      optional_tours: nextOptional,
    })
    .eq('id', id);
  if (updErr) throw updErr;
  console.log(`✅ ${pkg.short_code} | ${pkg.title} — ${changed}건 SSOT 정정`);
  return { id, changed };
}

(async () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  보홀 6 패키지 — attractions SSOT 재정정');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let total = 0;
  for (const id of ALL_IDS) {
    const isLong = IDS_4D6.includes(id);
    const r = await fixOne(id, isLong);
    total += r.changed;
  }
  console.log(`\n📊 총 ${total}건 SSOT 정정 완료\n`);

  // 검증
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ✔️  정정 후 검증');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  const { data: verify } = await sb
    .from('travel_packages')
    .select('short_code, itinerary_data, product_summary, optional_tours')
    .in('id', ALL_IDS)
    .order('short_code');
  for (const p of (verify || [])) {
    const days = p.itinerary_data?.days || [];
    const d4act = days[3]?.schedule?.[1]?.activity || '(N/A)';
    const dayTour = (p.optional_tours || []).find(t => t?.name === '보홀 데이투어');
    console.log(`${p.short_code}`);
    console.log(`   D4 데이투어 활동 : ${d4act}`);
    console.log(`   opt note        : ${dayTour?.note || '(none)'}`);
    if (p.product_summary?.includes('안경원숭이') || p.product_summary?.includes('타리스어')) {
      const idx = p.product_summary.indexOf('타리') !== -1
        ? p.product_summary.indexOf('타리')
        : p.product_summary.indexOf('안경');
      console.log(`   summary snippet : ...${p.product_summary.slice(Math.max(0, idx-10), idx+25)}...`);
    }
    console.log();
  }
})();
