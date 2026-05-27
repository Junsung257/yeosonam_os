/**
 * @file fix_nagasaki_20260419.js
 * @description 2026-04-19 ERR-FUK-rawtext-pollution 사후 수정
 *   1. raw_text를 랜드사 원문 원본으로 복구 + sha256
 *   2. inclusions "2억 여행자보험" → "여행자보험"
 *   3. surcharges에서 excluded_dates와 겹치는 일자성 항목 제거
 *   4. 품격(LB-FUK-03-02) Day2 regions 복원: [사세보, 나가사키, 사세보]
 *
 * 실행: node db/fix_nagasaki_20260419.js [--dry]
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

const DRY = process.argv.includes('--dry');
const IDS = {
  jeongtong: '2227e9c4-a8ba-464e-b89e-4b901625fa8e',
  pumgyeok:  'e4a2ae42-d00e-484a-ad78-3785c955448b',
};

const originalPath = path.join(__dirname, '..', 'scratch', 'landbusan_nagasaki_golf_20260401_original.txt');
const rawOriginal = fs.readFileSync(originalPath, 'utf8');
const rawHash = crypto.createHash('sha256').update(rawOriginal).digest('hex');

function fixInclusions(arr) {
  return (arr || []).map(s => (typeof s === 'string' ? s.replace(/^\s*\d+\s*억\s+/, '').replace(/\s{2,}/g, ' ').trim() : s));
}

function fixSurcharges(surcharges, excludedDates) {
  if (!Array.isArray(surcharges)) return surcharges;
  const exSet = new Set((excludedDates || []).map(d => String(d).slice(0, 10)));
  return surcharges.filter(s => {
    if (!s?.start || !s?.end) return true;
    // 기간에 excluded_date가 하나라도 겹치면 중복이므로 제거
    const start = new Date(s.start); const end = new Date(s.end);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (exSet.has(d.toISOString().slice(0, 10))) return false;
    }
    return true;
  });
}

function fixPumgyeokRegions(itineraryData) {
  const cloned = JSON.parse(JSON.stringify(itineraryData || {}));
  if (!cloned.days) return cloned;
  // Day1: 부산 → 후쿠오카 → 나가사키 → 사세보 (나가사키 추가)
  if (cloned.days[0]) {
    const r = cloned.days[0].regions || [];
    if (!r.includes('나가사키')) {
      const idx = r.indexOf('사세보');
      if (idx > 0) r.splice(idx, 0, '나가사키'); else r.push('나가사키');
      cloned.days[0].regions = r;
    }
  }
  // Day2: 사세보 → 나가사키 → 사세보
  if (cloned.days[1]) {
    cloned.days[1].regions = ['사세보', '나가사키', '사세보'];
  }
  return cloned;
}

(async () => {
  console.log(`🔧 Nagasaki 2건 사후 수정 ${DRY ? '(DRY-RUN)' : '(실행)'}\n`);
  console.log(`원문 파일: ${originalPath}`);
  console.log(`원문 크기: ${rawOriginal.length} chars`);
  console.log(`SHA-256  : ${rawHash}\n`);

  const { data: rows } = await sb.from('travel_packages')
    .select('id, short_code, title, inclusions, surcharges, excluded_dates, itinerary_data, parsed_data, raw_text')
    .in('id', Object.values(IDS));

  for (const r of rows) {
    const isPumgyeok = r.id === IDS.pumgyeok;
    const update = {
      raw_text: rawOriginal,
      raw_text_hash: rawHash,
      parsed_data: { ...(r.parsed_data || {}), prior_raw_text_summary: r.raw_text || null, fix_applied: 'ERR-FUK-rawtext-pollution@2026-04-19' },
      inclusions: fixInclusions(r.inclusions),
      surcharges: fixSurcharges(r.surcharges, r.excluded_dates),
    };
    if (isPumgyeok) {
      update.itinerary_data = fixPumgyeokRegions(r.itinerary_data);
    }

    console.log(`── ${r.short_code} | ${r.title}`);
    console.log(`   inclusions:`);
    console.log(`     before: ${JSON.stringify(r.inclusions)}`);
    console.log(`     after : ${JSON.stringify(update.inclusions)}`);
    console.log(`   surcharges count: ${(r.surcharges||[]).length} → ${update.surcharges.length}`);
    if (isPumgyeok) {
      console.log(`   Day1 regions: ${JSON.stringify(r.itinerary_data?.days?.[0]?.regions)} → ${JSON.stringify(update.itinerary_data.days[0].regions)}`);
      console.log(`   Day2 regions: ${JSON.stringify(r.itinerary_data?.days?.[1]?.regions)} → ${JSON.stringify(update.itinerary_data.days[1].regions)}`);
    }
    console.log(`   raw_text: ${(r.raw_text||'').length} chars (요약본) → ${rawOriginal.length} chars (원문)\n`);

    if (!DRY) {
      const { error } = await sb.from('travel_packages').update(update).eq('id', r.id);
      if (error) { console.error(`   ❌ UPDATE 실패:`, error); process.exit(1); }
      console.log(`   ✅ UPDATE 완료\n`);
    }
  }

  if (DRY) console.log('DRY-RUN 완료 — --dry 없이 재실행하면 반영됩니다.');
  else console.log('✅ 2건 전체 UPDATE 반영 완료.');
})().catch(e => { console.error(e); process.exit(1); });
