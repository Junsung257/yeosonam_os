/**
 * 아이디투어 보홀 6 패키지 — 원문 verbatim 정정
 *
 * 사장님 "원문 다시 대조해서 오류수정" 지시 (2026-04-27)
 *
 * 정정 항목:
 *   1. ALL: D2 schedule "▶전통오일마사지" → "▶전신마사지" (원문 일정 verbatim)
 *      - 원문 포함사항: "전통오일마사지1시간(아동불포함)"  ← inclusions 보존
 *      - 원문 D2 일정:   "▶ 여행의 피로를 풀어줄 전신마사지 1시간"  ← schedule 정정
 *      - 원문 자체 모순. 일정 verbatim 우선.
 *
 *   2. 4박6일 3개: D4 데이투어 "타르시어원숭이·초콜릿힐" → "타리스어원숭이·초콜렛힐"
 *
 *   3. ALL: checkout day 시내관광 "(사왕 재래시장 · 성어거스틴 성당)" → "(사왕 재래시장+성어거스틴성당)"
 *
 *   4. 4박6일 3개: product_summary "타르시어원숭이·초콜릿힐" → "타리스어원숭이·초콜렛힐"
 *
 *   5. ALL: optional_tours[보홀 데이투어].note 표기 동기화
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

const IDS_3D5 = [
  'c334c6f3-5121-4cac-a8b5-e1ab3dca8a7d', // ID-BHO-05-01 돌핀베이
  'e5bb7479-da1b-4379-8a7e-b40daf1faca8', // ID-BHO-05-02 헤난 타왈라
  '16ca09f9-d2f9-40c2-ad5b-1f65877fb59b', // ID-BHO-05-03 헤난 알로나·코스트
];
const IDS_4D6 = [
  '396f91f0-0287-4ea1-9d9b-7627b3597469', // ID-BHO-06-01 돌핀베이
  'ecb62ece-d118-4dc3-8ac2-df4a407c4715', // ID-BHO-06-02 헤난 타왈라
  '4e4d085f-b392-48e0-8eee-3a6cb97ae312', // ID-BHO-06-03 헤난 알로나·코스트
];
const ALL_IDS = [...IDS_3D5, ...IDS_4D6];

// schedule 변경 매핑
const REPLACEMENTS = [
  { from: '▶전통오일마사지 1시간 (팁별도 · 아동불포함)', to: '▶전신마사지 1시간 (팁별도 · 아동불포함)' },
  { from: '▶보홀 시내관광 (사왕 재래시장 · 성어거스틴 성당)', to: '▶보홀 시내관광 (사왕 재래시장+성어거스틴성당)' },
];
const REPLACEMENTS_4D6_ONLY = [
  { from: '▶보홀 데이투어 (타르시어원숭이·초콜릿힐·멘메이드포레스트)', to: '▶보홀 데이투어 (타리스어원숭이·초콜렛힐·멘메이드포레스트)' },
];

const PRODUCT_SUMMARY_REPLACE_4D6 = {
  from: '타르시어원숭이·초콜릿힐',
  to: '타리스어원숭이·초콜렛힐',
};

const OPTIONAL_NOTE_FROM = '2인 이상 · 타르시어원숭이·초콜릿힐·멘메이드포레스트';
const OPTIONAL_NOTE_TO   = '2인 이상 · 타리스어원숭이·초콜렛힐·멘메이드포레스트';

function patchActivity(act, isLong) {
  if (!act || typeof act !== 'string') return act;
  let next = act;
  for (const r of REPLACEMENTS) if (next === r.from) next = r.to;
  if (isLong) {
    for (const r of REPLACEMENTS_4D6_ONLY) if (next === r.from) next = r.to;
  }
  return next;
}

async function fixOne(id, isLong) {
  const { data: rows, error: selErr } = await sb
    .from('travel_packages')
    .select('id, short_code, title, itinerary_data, product_summary, optional_tours')
    .eq('id', id)
    .limit(1);
  if (selErr) throw selErr;
  const pkg = rows?.[0];
  if (!pkg) {
    console.log(`⚠️  ${id} not found`);
    return { id, changed: 0 };
  }

  let changed = 0;

  // 1+2+3. itinerary_data.days[].schedule[].activity
  const itin = JSON.parse(JSON.stringify(pkg.itinerary_data || {}));
  for (const day of (itin.days || [])) {
    for (const item of (day.schedule || [])) {
      const before = item.activity;
      const after = patchActivity(before, isLong);
      if (before !== after) {
        item.activity = after;
        changed++;
      }
    }
  }

  // 4. product_summary (4박6일만)
  let nextSummary = pkg.product_summary;
  if (isLong && pkg.product_summary && pkg.product_summary.includes(PRODUCT_SUMMARY_REPLACE_4D6.from)) {
    nextSummary = pkg.product_summary.split(PRODUCT_SUMMARY_REPLACE_4D6.from).join(PRODUCT_SUMMARY_REPLACE_4D6.to);
    if (nextSummary !== pkg.product_summary) changed++;
  }

  // 5. optional_tours[].note (모든 패키지 — 보홀 데이투어 항목)
  const nextOptional = JSON.parse(JSON.stringify(pkg.optional_tours || []));
  for (const t of nextOptional) {
    if (t?.name === '보홀 데이투어' && t?.note === OPTIONAL_NOTE_FROM) {
      t.note = OPTIONAL_NOTE_TO;
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
  if (updErr) {
    console.error(`❌ ${pkg.short_code} 업데이트 실패: ${updErr.message}`);
    throw updErr;
  }
  console.log(`✅ ${pkg.short_code} | ${pkg.title} — ${changed}건 정정`);
  return { id, changed };
}

(async () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  보홀 6 패키지 — 원문 verbatim 정정');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let total = 0;
  for (const id of IDS_3D5) {
    const r = await fixOne(id, false);
    total += r.changed;
  }
  for (const id of IDS_4D6) {
    const r = await fixOne(id, true);
    total += r.changed;
  }

  console.log(`\n📊 총 ${total}건 필드 정정 완료\n`);

  // 정정 후 검증
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ✔️  정정 후 검증 (각 패키지 D2/D4 활동 + summary)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  const { data: verify } = await sb
    .from('travel_packages')
    .select('short_code, itinerary_data, product_summary')
    .in('id', ALL_IDS)
    .order('short_code');
  for (const p of (verify || [])) {
    const days = p.itinerary_data?.days || [];
    const d2act = days[1]?.schedule?.[2]?.activity;
    const d4act = days[3]?.schedule?.[1]?.activity;
    const sum = (p.product_summary || '').slice(0, 80);
    console.log(`${p.short_code}`);
    console.log(`   D2 [2]: ${d2act}`);
    console.log(`   D4 [1]: ${d4act}`);
    console.log(`   summary: ${sum}…\n`);
  }
})();
