#!/usr/bin/env node
/**
 * @file db/backfill_unmatched_20260421.js
 * @description ERR-unmatched-queue-middleware-401@2026-04-21 즉시 조치.
 *   2026-04-10 이후 등록된 pkg 16건이 middleware 401 로 unmatched_activities 에 큐잉 실패.
 *   본 스크립트가 서버사이드에서 직접 DB 에 백필.
 *
 * 사용:
 *   node db/backfill_unmatched_20260421.js              # dry-run (요약만)
 *   node db/backfill_unmatched_20260421.js --insert     # 실제 upsert
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnv() {
  const envFile = fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf-8');
  const env = {};
  envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
  return env;
}

const SKIP = /^(호텔|리조트)?\s*(조식|투숙|체크|휴식|이동|출발|도착|귀환|수속|공항|탑승|기내|자유시간|석식|중식|면세점|쇼핑센터|가이드|미팅)/;
const CAT_SKIP = /공항|출발|도착|이동|수속|탑승|귀환|체크인|체크아웃|투숙|휴식|미팅|조식|중식|석식/;

function matchSubstring(activity, attrs, STOP) {
  const act = (activity || '').toLowerCase();
  for (const a of attrs) {
    if (!a.name || a.name.length < 2 || STOP.has(a.name)) continue;
    if (act.includes(a.name.toLowerCase())) return a;
    if (Array.isArray(a.aliases)) {
      for (const alias of a.aliases) {
        if (!alias || alias.length < 2 || STOP.has(alias)) continue;
        if (act.includes(alias.toLowerCase())) return a;
      }
    }
  }
  return null;
}

async function main() {
  const insert = process.argv.includes('--insert');
  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // 1. 2026-04-10 이후 등록된 pkg 조회
  const { data: pkgs, error: pkgErr } = await sb
    .from('travel_packages')
    .select('id, short_code, title, destination, itinerary_data')
    .gte('created_at', '2026-04-10')
    .in('status', ['active', 'approved', 'pending', 'draft'])
    .order('created_at', { ascending: false });
  if (pkgErr) { console.error('❌ pkg 조회 실패:', pkgErr.message); process.exit(1); }
  console.log(`\n📦 2026-04-10 이후 등록 pkg: ${pkgs.length}건`);

  // 2. 전체 attractions 페이지네이션 로드
  let attractions = [];
  const PAGE = 1000;
  for (let from = 0; from < 100000; from += PAGE) {
    const { data } = await sb
      .from('attractions')
      .select('id, name, aliases, country, region')
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    attractions.push(...data);
    if (data.length < PAGE) break;
  }
  console.log(`📚 attractions 로드: ${attractions.length}건`);

  const STOP = new Set([
    '호텔','방콕','파타야','부산','청도','보홀','다낭','하노이','호이안','후에',
    '타이페이','후쿠오카','나가사키','오사카','교토','나라','도쿄','서안','북경','상해',
    '울란바토르','알마티','세부','푸켓','발리','제주','인천','김포','나하','호화호특',
    '황산','나트랑','달랏','판랑','캄란','푸꾸옥','하롱','닌빈','치앙마이','방비엥',
    '쿠알라','말라카','겐팅','말레이시아','싱가포르','중국','일본','베트남',
    '조식','중식','석식','이동','출발','도착','귀환','관광','체크인','체크아웃',
    '휴식','투숙','공항','미팅','가이드','수속','탑승','호텔식','현지식','기내식',
    '시내','시장','거리','면세점','마사지','온천','쇼핑','공원','사원','교회',
    '성당','광장','박물관','궁전','탑','섬','해변','호수','다리','야시장','동굴','산',
    '전망대','분수','정원','폭포',
  ]);

  // 3. 각 pkg 에 대해 미매칭 activity 수집
  const allUnmatched = [];
  let matchedTotal = 0;
  for (const pkg of pkgs) {
    const days = pkg.itinerary_data?.days || (Array.isArray(pkg.itinerary_data) ? pkg.itinerary_data : []);
    // destination 으로 attractions 필터
    const dest = pkg.destination || '';
    const filtered = attractions.filter(a => {
      if (!a.region) return true;
      return dest.includes(a.region) || a.region.includes(dest) || (a.country && dest.includes(a.country));
    });
    const sorted = filtered.slice().sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));

    let pkgUnmatched = 0;
    for (const day of days) {
      for (const item of (day.schedule || [])) {
        const activity = item.activity || '';
        if (!activity || SKIP.test(activity)) continue;
        if (item.type === 'flight' || item.type === 'hotel' || item.type === 'shopping') continue;
        if (CAT_SKIP.test(activity)) continue;
        // 매칭 시도
        const match = matchSubstring(activity, sorted, STOP);
        if (match) { matchedTotal++; continue; }
        // 미매칭 → 큐잉 대상
        pkgUnmatched++;
        allUnmatched.push({
          activity,
          package_id: pkg.id,
          package_title: pkg.title,
          day_number: day.day,
          country: dest,
          region: null,
          occurrence_count: 1,
          status: 'pending',
        });
      }
    }
    console.log(`  ${pkg.short_code.padEnd(18)} ${pkg.destination.padEnd(14)} → 미매칭 ${pkgUnmatched}건`);
  }

  console.log(`\n📊 집계: 총 pkg ${pkgs.length}건 / 매칭 ${matchedTotal}건 / 미매칭 ${allUnmatched.length}건`);

  if (!insert) {
    console.log('\n💡 --insert 플래그 없이 실행 → dry-run 종료. 실제 upsert 를 원하면 --insert 플래그 추가.');
    return;
  }

  // 4. 배치 내 activity 중복 제거 (여러 pkg 가 같은 문구 공유할 때 ON CONFLICT 충돌 방지)
  //    첫 항목만 유지. occurrence_count 는 aggregate 해서 보존.
  const byActivity = new Map();
  for (const it of allUnmatched) {
    const existing = byActivity.get(it.activity);
    if (existing) {
      existing.occurrence_count += 1;
    } else {
      byActivity.set(it.activity, { ...it });
    }
  }
  const deduped = [...byActivity.values()];
  console.log(`🧹 중복 제거 후: ${deduped.length}건 (원본 ${allUnmatched.length}건)`);

  const BATCH = 500;
  let upserted = 0;
  for (let i = 0; i < deduped.length; i += BATCH) {
    const chunk = deduped.slice(i, i + BATCH);
    const { error } = await sb.from('unmatched_activities').upsert(chunk, { onConflict: 'activity' });
    if (error) { console.error(`❌ 배치 ${i}~${i + chunk.length} 실패:`, error.message); continue; }
    upserted += chunk.length;
  }
  console.log(`\n✅ upsert 완료: ${upserted} / ${allUnmatched.length}`);

  // 5. 재확인
  const { count: pendingNow } = await sb
    .from('unmatched_activities')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');
  console.log(`📊 업데이트 후 status='pending' 총 count: ${pendingNow}`);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
