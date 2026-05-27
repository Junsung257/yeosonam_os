/**
 * @file db/patch_hohhot_render_fix_20260421.js
 * @description ERR-HET-render-over-split 즉시 조치 — 괄호 안 콤마 과다 분리로
 *   체험/부연설명이 ▶ 관광지로 승격된 것을 원상복구.
 *
 * 대상: TT-HET-05-01 (품격), TT-HET-05-02 (고품격)
 * 수정 원칙:
 *   1. 통합 activity 로 되돌리되, 괄호 안 콤마는 "·" 로 변환 → splitScheduleItems 재진입 시
 *      ",없음" 조건에 걸려 분리 skip.
 *   2. 각 Day 의 schedule 배열을 통째로 교체 (idempotent — 반복 실행해도 동일 결과).
 *   3. Day 3 만 품격 ↔ 고품격 마사지 문구 다름 (품격 발마사지 50분 / 고품격 발+전신 80분).
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

const N = (time, activity) => ({ time: time || null, activity, type: 'normal', transport: null, note: null });
const F = (time, activity, transport) => ({ time, activity, type: 'flight', transport, note: null });

// ── 공용 Day 정의 (괄호 안 콤마 → · 로 치환) ──────────────────────
const DAY1 = {
  day: 1, regions: ['부산', '호화호특'],
  meals: { breakfast: false, lunch: true, dinner: true, breakfast_note: null, lunch_note: '샤브샤브', dinner_note: '현지식' },
  schedule: [
    F('07:30', '부산 김해국제공항 출발 → 호화호특 국제공항 09:55 도착', 'BX3455'),
    N(null, '가이드 미팅 후 시내로 이동 (약 30분)'),
    N(null, '중식'),
    N(null, '지평선이 닫는 시라무런 초원으로 이동'),
    N(null, '▶시라무런 초원 대초원 산책 및 승마체험 (약 40분 소요)'),
    N(null, '▶유목민 생활 체험 (초원 오토바이·활쏘기·몽골족 간식 및 밀크티 맛보기·전통 몽골 복장 체험 및 사진 촬영·오보우산에서 전초원 관람)'),
    N(null, '▶대형 마상공연 관람 (60마리 말과 사람이 함께하는 대형 마상공연)'),
    N(null, '초원 일몰 감상 (자율)'),
    N(null, '석식 후 초원 캠프 파이어 및 민속공연 관람 (우천 시 진행불가)'),
    N(null, '초원의 쏟아지는 별자리 감상'),
    N(null, '호텔 투숙 및 휴식'),
  ],
};

const DAY2 = {
  day: 2, regions: ['초원', '춘쿤산', '사막', '호화호특'],
  meals: { breakfast: true, lunch: true, dinner: true, breakfast_note: '호텔식', lunch_note: '야채비빔밥', dinner_note: '무제한삼겹살' },
  schedule: [
    N('04:30', '기상 후 초원 일출 감상 (자율)'),
    N(null, '조식 후 춘쿤산으로 이동 (약 2시간 30분 소요)'),
    N(null, '▶춘쿤산 관광 (2340M 높이의 구름 속 초원이라 불리는 춘쿤산·전통카트왕복 및 전망대관람 포함)'),
    N(null, '5A급관광구 샹사완 사막으로 이동 (약 2시간 소요)'),
    N(null, '▶샹사완 사막 액티비티 체험 (써핑카트·사막낙타체험·사막4륜오토바이·모래썰매)'),
    N(null, '사막 안에서 일몰 감상하며 석식'),
    N(null, '호화호특으로 이동 (약 2시간 30분 소요)'),
    N(null, '호텔 투숙 및 휴식'),
  ],
};

const DAY3_PKG1 = {
  day: 3, regions: ['호화호특'],
  meals: { breakfast: true, lunch: true, dinner: true, breakfast_note: '게르식', lunch_note: '현지식', dinner_note: '한식' },
  schedule: [
    N(null, '호텔 조식 후 호화호특으로 이동 (약 2시간 30분)'),
    N(null, '▶싸이쌍 옛거리 (400년 역사를 가진 옛거리)'),
    N(null, '▶오탑사(五塔寺) (460년 역사를 가진 사찰)'),
    N(null, '▶발마사지 체험 50분 (매너팁 5불 불포함)'),
    N(null, '호텔 투숙 및 휴식'),
  ],
};

const DAY3_PKG2 = {
  day: 3, regions: ['호화호특'],
  meals: { breakfast: true, lunch: true, dinner: true, breakfast_note: '게르식', lunch_note: '현지식', dinner_note: '한식' },
  schedule: [
    N(null, '호텔 조식 후 호화호특으로 이동 (약 2시간 30분)'),
    N(null, '▶싸이쌍 옛거리 (400년 역사를 가진 옛거리)'),
    N(null, '▶오탑사(五塔寺) (460년 역사를 가진 사찰)'),
    N(null, '▶발+전신마사지 체험 80분 (매너팁 5불 불포함)'),
    N(null, '호텔 투숙 및 휴식'),
  ],
};

const DAY4 = {
  day: 4, regions: ['호화호특'],
  meals: { breakfast: true, lunch: true, dinner: true, breakfast_note: '초원식', lunch_note: '현지식(소머리찜)', dinner_note: '동북요리' },
  schedule: [
    N(null, '호텔 조식'),
    N(null, '▶왕소군묘 (2000년 역사를 가진곳·중국 4대 미인 중 한 명·평화의 상징)'),
    N(null, '▶내몽고민속용품공장 (중국 4A급 관광지·명량관광)'),
    N(null, '▶내몽고박물관 (아시아 최대 공룡화석관 및 8개관 관광)'),
    N(null, '석식'),
    N(null, '호텔 투숙 및 휴식'),
  ],
};

const DAY5 = {
  day: 5, regions: ['호화호특', '부산'],
  meals: { breakfast: true, lunch: true, dinner: false, breakfast_note: '호텔식', lunch_note: '간편도시락(빵, 옥수수, 과일, 물)', dinner_note: null },
  schedule: [
    N(null, '호텔 조식 후 호화호특 공항으로 이동'),
    F('11:55', '호화호특 국제공항 출발 → 부산 김해국제공항 16:30 도착', 'BX3465'),
  ],
};

// 호텔 정보 (pkg 별 상이)
const PKG1_HOTELS = [
  { name: '비즈니스 게르', grade: '게르', note: '2인1실, 화장실·샤워실 있음' },
  { name: '다라터치 카이홍 인터네셔널호텔', grade: '준5성급', note: '또는 동급 호텔' },
  { name: '하이량프라자호텔', grade: '준5성급', note: '또는 동급 호텔' },
  { name: '하이량프라자호텔', grade: '준5성급', note: '또는 동급 호텔' },
  { name: null, grade: null, note: null },
];
const PKG2_HOTELS = [
  { name: '궁전 게르', grade: '게르(업그레이드)', note: '2인1실, 화장실·샤워실 있음' },
  { name: '달라터치 진이 우등 호텔', grade: '5성급', note: '또는 동급 호텔' },
  { name: '우란대주점호텔', grade: '5성급', note: '또는 동급 호텔' },
  { name: '우란대주점호텔', grade: '5성급', note: '또는 동급 호텔' },
  { name: null, grade: null, note: null },
];

function buildDays(pkgLabel) {
  const isPkg1 = pkgLabel === 'PKG1';
  const hotels = isPkg1 ? PKG1_HOTELS : PKG2_HOTELS;
  const day3 = isPkg1 ? DAY3_PKG1 : DAY3_PKG2;
  return [DAY1, DAY2, day3, DAY4, DAY5].map((d, i) => ({ ...d, hotel: hotels[i] }));
}

async function main() {
  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const TARGETS = [
    { id: 'dc40fbde-2cfa-4d2a-9e7d-f25d67a0891d', label: 'PKG1', short_code: 'TT-HET-05-01' },
    { id: '2a975749-2db7-4439-aa4d-3be0d00c9fb5', label: 'PKG2', short_code: 'TT-HET-05-02' },
  ];

  for (const t of TARGETS) {
    const { data: pkg, error: fetchErr } = await sb
      .from('travel_packages')
      .select('id, itinerary_data')
      .eq('id', t.id)
      .limit(1);
    if (fetchErr || !pkg?.[0]) { console.log(`❌ ${t.short_code} fetch 실패: ${fetchErr?.message}`); continue; }

    const current = pkg[0].itinerary_data;
    const patched = { ...current, days: buildDays(t.label) };

    const { error: updErr } = await sb
      .from('travel_packages')
      .update({ itinerary_data: patched, updated_at: new Date().toISOString() })
      .eq('id', t.id);
    if (updErr) { console.log(`❌ ${t.short_code} UPDATE 실패: ${updErr.message}`); continue; }

    const oldCount = (current?.days || []).reduce((s, d) => s + (d.schedule || []).length, 0);
    const newCount = patched.days.reduce((s, d) => s + d.schedule.length, 0);
    console.log(`✅ ${t.short_code}: schedule items ${oldCount} → ${newCount}`);
  }

  // ISR revalidate
  const secret = env.REVALIDATE_SECRET;
  if (secret) {
    const paths = TARGETS.map(t => `/packages/${t.id}`);
    try {
      const { default: fetchFn } = await import('node-fetch').catch(() => ({ default: global.fetch }));
      const ff = fetchFn || global.fetch;
      const base = env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';
      const res = await ff(`${base}/api/revalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths, secret }),
      });
      console.log(`🔄 ISR revalidate: ${res.status}`);
    } catch (e) {
      console.log(`⚠️  revalidate 실패 (무시 가능): ${e.message}`);
    }
  } else {
    console.log('ℹ️  REVALIDATE_SECRET 없음 — ISR 수동 재생성 대기');
  }
}

main().catch(err => { console.error('💥', err); process.exit(1); });
