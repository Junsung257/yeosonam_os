/**
 * ERR-20260428-01 — 카멜리아 후쿠오카 패키지 verbatim 위반 수정
 *
 * 발견된 6건 오류:
 *   1) D2 "다자이후 천만궁" → "태재부 천만궁" (원문 verbatim 복원)
 *   2) D2 "▶높이 234M·8000장" → "▶높이 234M, 8000장" (W30 정당 변환이지만 verbatim 손실 → 콤마 복원 + splitScheduleItems 보강으로 해결)
 *   3) D1 regions ['부산','카멜리아'] → ['부산'] (카멜리아는 교통편)
 *   4) inclusions "왕복 훼리비 (카멜리아)" → "왕복 훼리비" (환각 보강 제거)
 *   5) notices_parsed[0] "쇼핑센터 1회 (면세점)" → "쇼핑센터 1회" (환각 보강 제거)
 *   6) D3 "입국 수속 후 해산" → "입국 수속 후 안녕히" (verbatim)
 *
 * 부수 작업:
 *   - attractions "다자이후텐만구" aliases 에 한국어 변종 추가
 *   - ISR 캐시 무효화
 */

const fs = require('fs');
const path = require('path');
const envFile = fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const PKG_ID = 'e8a52d5f-cad6-4c55-a790-9f4f559ee341';
const ATTRACTION_ID = 'a6b67bfd-6139-46ad-bb82-f3de8456baeb'; // 다자이후텐만구

async function main() {
  // ─── 1) 패키지 fetch ────────────────────────────────────
  const { data: pkg, error: e1 } = await sb.from('travel_packages')
    .select('itinerary_data, inclusions, notices_parsed')
    .eq('id', PKG_ID)
    .single();
  if (e1) throw e1;

  // ─── 2) 수정 적용 ───────────────────────────────────────
  const itinerary = JSON.parse(JSON.stringify(pkg.itinerary_data));

  // D1 regions: 카멜리아 제거
  itinerary.days[0].regions = ['부산'];

  // D2 schedule verbatim 복원
  itinerary.days[1].schedule = itinerary.days[1].schedule.map(s => {
    if (s.activity === '▶높이 234M·8000장의 유리로 단장한 후쿠오카 타워 관광') {
      return { ...s, activity: '▶높이 234M, 8000장의 유리로 단장한 후쿠오카 타워 관광' };
    }
    if (s.activity === '▶학문의 신을 모신 다자이후 천만궁') {
      return { ...s, activity: '▶학문의 신을 모신 태재부 천만궁' };
    }
    return s;
  });

  // D3 마지막 활동 verbatim 복원
  itinerary.days[2].schedule = itinerary.days[2].schedule.map(s => {
    if (s.activity === '부산 국제 여객 터미널 도착 / 입국 수속 후 해산') {
      return { ...s, activity: '부산 국제 여객 터미널 도착 / 입국 수속 후 안녕히' };
    }
    return s;
  });

  const inclusions = pkg.inclusions.map(i => i === '왕복 훼리비 (카멜리아)' ? '왕복 훼리비' : i);

  const notices = pkg.notices_parsed.map(n => {
    if (n.text === '쇼핑센터 1회 (면세점)') return { ...n, text: '쇼핑센터 1회' };
    return n;
  });

  // ─── 3) DB UPDATE ──────────────────────────────────────
  const { error: e2 } = await sb.from('travel_packages')
    .update({ itinerary_data: itinerary, inclusions, notices_parsed: notices })
    .eq('id', PKG_ID);
  if (e2) throw e2;
  console.log('✅ [1/3] travel_packages verbatim 복원 완료');

  // ─── 4) attractions aliases 보강 ────────────────────────
  const { data: attr } = await sb.from('attractions').select('aliases').eq('id', ATTRACTION_ID).single();
  const newAliases = Array.from(new Set([
    ...(attr.aliases || []),
    '다자이후 천만궁',
    '태재부 천만궁',
    '태재부 텐만구',
    '태재부',
    '다자이후',
    '학문의 신',
    'Dazaifu Tenmangu',
    '太宰府天満宮',
  ]));
  const { error: e3 } = await sb.from('attractions')
    .update({ aliases: newAliases })
    .eq('id', ATTRACTION_ID);
  if (e3) throw e3;
  console.log(`✅ [2/3] 다자이후텐만구 aliases ${newAliases.length}개 적립`);

  // ─── 5) ISR 캐시 무효화 시도 ────────────────────────────
  try {
    const res = await fetch('http://localhost:3000/api/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paths: [`/packages/${PKG_ID}`, '/packages'],
        secret: env.REVALIDATE_SECRET || env.NEXT_PUBLIC_REVALIDATE_SECRET,
      }),
    });
    console.log(`✅ [3/3] ISR 무효화 ${res.status}`);
  } catch (err) {
    console.log(`ℹ️  [3/3] ISR 무효화 스킵 (dev 서버 미가동): ${err.message}`);
  }

  console.log('\n📋 수정 완료 요약');
  console.log('   • D1 regions:    [부산, 카멜리아] → [부산]');
  console.log('   • D2 schedule:   "다자이후" → "태재부", "234M·8000장" → "234M, 8000장"');
  console.log('   • D3 schedule:   "해산" → "안녕히"');
  console.log('   • inclusions:    "왕복 훼리비 (카멜리아)" → "왕복 훼리비"');
  console.log('   • notices_parsed: "쇼핑센터 1회 (면세점)" → "쇼핑센터 1회"');
  console.log('   • attractions:   다자이후텐만구 aliases +8개 (태재부 등)');
}

main().catch(err => { console.error('❌', err); process.exit(1); });
