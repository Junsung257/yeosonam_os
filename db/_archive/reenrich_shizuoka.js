/**
 * 시즈오카 패키지 itinerary_data 강제 re-enrich.
 * SQL 직접 INSERT 한 8건 attractions 가 모바일에 표출되도록 attraction_ids[] 박음.
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(SB_URL, SB_KEY);

// matchAttraction 알고리즘 inline (TS 의존 회피)
const SKIP_PATTERN = /^(호텔|리조트)?\s*(조식|투숙|체크|휴식|이동|출발|도착|귀환|수속|공항|탑승|기내|자유시간|석식|중식|면세점|쇼핑센터|가이드|미팅)/;
const STOP_WORDS = new Set(['호텔','조식','중식','석식','이동','출발','도착','귀환','관광','체크인','체크아웃','휴식','투숙','공항','미팅','가이드','수속','탑승','한식','자유','시내','시장','거리','면세점','마사지','온천','쇼핑','맥주','영화','체험','촬영','다이빙','케이블카','입장','관람','탐방','공원','사원','교회','성당','광장','박물관','궁전','탑','섬','해변','호수','다리','거리','야시장','동굴','산','전망대','분수','정원','폭포']);

function matchAttraction(activity, attractions, destination) {
  if (!activity || !attractions?.length) return null;
  if (SKIP_PATTERN.test(activity)) return null;
  const destTrim = (destination ?? '').trim();
  const filtered = destTrim
    ? attractions.filter(a => !a.region || destTrim.includes(a.region) || a.region.includes(destTrim) || (a.country && destTrim.includes(a.country)))
    : attractions;
  const filtered2 = filtered.filter(a => a.category !== 'accommodation' && !a.mrt_gid);
  const actLower = activity.toLowerCase();
  const actNoSpace = activity.replace(/\s+/g, '').toLowerCase();

  // 1. exact name
  for (const a of filtered2) if (a.name && a.name.toLowerCase() === actLower) return a;
  // 2. alias exact
  for (const a of filtered2) for (const al of (a.aliases ?? [])) if (al.toLowerCase() === actLower) return a;
  // 3-4. 양방향 substring (긴 이름 우선)
  const sorted = filtered2.slice().sort((a,b) => (b.name?.length ?? 0) - (a.name?.length ?? 0));
  for (const a of sorted) {
    if (!a.name || a.name.length < 2 || STOP_WORDS.has(a.name)) continue;
    const nameLower = a.name.toLowerCase();
    const nameNoSpace = nameLower.replace(/\s+/g, '');
    if (actLower.includes(nameLower)) return a;
    if (nameNoSpace.length >= 2 && actNoSpace.includes(nameNoSpace)) return a;
    if (activity.length >= 2 && !STOP_WORDS.has(activity) && nameLower.includes(actLower)) return a;
    if (actNoSpace.length >= 2 && !STOP_WORDS.has(activity) && nameNoSpace.includes(actNoSpace)) return a;
  }
  // 5. aliases substring
  for (const a of filtered2) for (const al of (a.aliases ?? [])) {
    if (!al || al.length < 2 || STOP_WORDS.has(al)) continue;
    const alL = al.toLowerCase();
    const alN = al.replace(/\s+/g, '').toLowerCase();
    if (actLower.includes(alL) || actNoSpace.includes(alN)) return a;
  }
  return null;
}

async function main() {
  // 1) 시즈오카 패키지 fetch
  const { data: pkgs } = await sb
    .from('travel_packages')
    .select('id, title, destination, itinerary_data')
    .ilike('destination', '%시즈오카%');
  console.log(`시즈오카 패키지: ${pkgs?.length ?? 0}건`);

  // 2) 시즈오카 + JP attractions fetch
  const { data: attrs } = await sb
    .from('attractions')
    .select('id, name, aliases, region, country, category, mrt_gid')
    .eq('is_active', true)
    .or('region.eq.시즈오카,country.eq.시즈오카,country.eq.JP');
  console.log(`매칭 후보 attractions: ${attrs?.length ?? 0}건`);

  for (const pkg of pkgs ?? []) {
    const itin = pkg.itinerary_data;
    const days = itin?.days ?? [];
    if (days.length === 0) { console.log(`  [${pkg.id.slice(0,8)}] days 0`); continue; }

    let totalMatched = 0;
    const newDays = days.map(day => {
      const newSchedule = (day.schedule ?? []).map(item => {
        if (!item.activity || item.type === 'flight' || item.type === 'hotel') return item;
        const found = new Map();
        // 라인 통째
        const m = matchAttraction(item.activity, attrs, pkg.destination);
        if (m) found.set(m.id, m);
        // 콤마 split 도 시도
        const parts = item.activity.split(/[,，]\s*/).map(s => s.trim()).filter(s => s.length >= 2);
        for (const p of parts) {
          const m2 = matchAttraction(p, attrs, pkg.destination);
          if (m2) found.set(m2.id, m2);
        }
        if (found.size === 0) return item;
        const values = [...found.values()];
        totalMatched += values.length;
        return {
          ...item,
          attraction_ids: values.map(v => v.id),
          attraction_names: values.map(v => v.name),
          attraction_note: values[0].short_desc ?? item.attraction_note ?? null,
        };
      });
      return { ...day, schedule: newSchedule };
    });

    if (totalMatched === 0) {
      console.log(`  [${pkg.id.slice(0,8)}] ${pkg.title.slice(0,40)} — 매칭 0`);
      continue;
    }

    const { error } = await sb
      .from('travel_packages')
      .update({ itinerary_data: { ...itin, days: newDays }, updated_at: new Date().toISOString() })
      .eq('id', pkg.id);

    if (error) console.log(`  [${pkg.id.slice(0,8)}] UPDATE 실패: ${error.message}`);
    else console.log(`  [${pkg.id.slice(0,8)}] ${pkg.title.slice(0,40)} — ${totalMatched}건 매칭 ✓`);
  }

  console.log('\n사장님: /packages/<id> 또는 /m/packages/<id> 새로고침 (Ctrl+F5) → attraction 카드 표시');
}

main().catch(e => console.error(e.message));
