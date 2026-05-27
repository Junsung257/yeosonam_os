/**
 * TL-SJW-04-01 / TL-SJW-05-02 — 원문 충실도 회복 수정
 *
 * 발견된 오류 (5건):
 *   1. D1 환각 "출발 2시간 전 청주국제공항 미팅 후 수속" 제거 (원문 없음)
 *   2. 보천대협곡 부속 코스 13단계 원문 그대로 복원 (입구/출구/중복 전동카·셔틀버스)
 *   3. ▶ 메인 이름(천계산·보천대협곡·대협곡·동태항) 제거 — 원문은 부속관광지부터 시작
 *   4. [전동카 포함] 원위치 복원 (운봉화랑 / 환산선·환산성 일주)
 *   5. 광부고성·전신마사지 원문 표현 그대로 복원
 *
 * 수정 범위: itinerary_data.days[].schedule 만 변경. 다른 필드는 보존.
 */
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const envPath = path.resolve(__dirname, '..', '.env.local');
const envFile = fs.readFileSync(envPath, 'utf-8');
const env = {};
envFile.split('\n').forEach(l => {
  const [k, ...v] = l.split('=');
  if (k) env[k.trim()] = v.join('=').trim();
});
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const N = (time, activity, transport) => ({
  time: time || null, activity, type: 'normal', transport: transport || null, note: null,
});
const F = (time, activity, transport) => ({ time, activity, type: 'flight', transport, note: null });
const H = (activity) => ({ time: null, activity, type: 'hotel', transport: null, note: null });
const meal = (b, l, d, bn, ln, dn) => ({
  breakfast: b, lunch: l, dinner: d,
  breakfast_note: bn || null, lunch_note: ln || null, dinner_note: dn || null,
});

const HOTEL_LINJU  = { name: '임주 환빈서안호텔 또는 동급', grade: '5성급', note: '2인1실' };
const HOTEL_HANDAN = { name: '한단 영양국제호텔 또는 동급', grade: '5성급', note: '2인1실' };

// ── 4박5일 (TL-SJW-05-02) — 원문 그대로 ──
const DAYS_5D = [
  {
    day: 1,
    regions: ['청주', '석가장', '임주'],
    meals: meal(false, false, true, null, null, '샤브샤브 무제한'),
    schedule: [
      F('14:25', 'RF8133 청주국제공항 출발 → 석가장국제공항 15:45 도착', 'RF8133'),
      N(null, '석가장 국제공항 도착 후 가이드 미팅'),
      N(null, '임주로 이동 [약 4시간 30분 소요]', '전용차량'),
      N(null, '석식 후 호텔 투숙 및 휴식'),
      H('임주 환빈서안호텔 또는 동급 (5성급)'),
    ],
    hotel: HOTEL_LINJU,
  },
  {
    day: 2,
    regions: ['임주', '천계산', '보천대협곡', '임주'],
    meals: meal(true, true, true, '호텔식', '산채비빔밥', '삼겹살 무제한'),
    schedule: [
      N(null, '호텔 조식 후 천계산으로 이동 [약 1시간 30분 소요]'),
      N(null, '▶운봉화랑[전동카 포함]-시담대-여화대-유리잔도'),
      N(null, '중식 후 보천대협곡으로 이동 [약 40분 소요]'),
      N(null, '▶입구-셔틀버스-공중버스-쌍심플래폼-레일케이블카-전동카-유리전망대-전동카-동굴엘레베이터-전동카-셔틀버스-출구'),
      N(null, '임주로 이동 [약 2시간 소요]', '전용차량'),
      N(null, '▶피로를 풀어주는 전신마사지 90분 체험 [매너팁 별도]'),
      N(null, '석식 후 호텔 투숙 및 휴식'),
      H('임주 환빈서안호텔 또는 동급 (5성급)'),
    ],
    hotel: HOTEL_LINJU,
  },
  {
    day: 3,
    regions: ['임주', '대협곡', '한단'],
    meals: meal(true, true, true, '호텔식', '동태찌개', '현지식'),
    schedule: [
      N(null, '호텔 조식 후 대협곡으로 이동 [약 50분 소요]'),
      N(null, '▶도화곡-황룡담-이룡희주-함주-구련폭포[도보로 약 60분] 환산선 일주[전동카 포함]-천갱-수녀봉-몽환곡'),
      N(null, '중식 후 한단으로 이동 [약 1시간 40분 소요]', '전용차량'),
      N(null, '석식 후 호텔 투숙 및 휴식'),
      H('한단 영양국제호텔 또는 동급 (5성급)'),
    ],
    hotel: HOTEL_HANDAN,
  },
  {
    day: 4,
    regions: ['한단', '동태항', '한단'],
    meals: meal(true, true, true, '호텔식', '된장찌개+보쌈', '현지식'),
    schedule: [
      N(null, '호텔 조식 후 동태항으로 이동 [약 1시간 20분 소요]'),
      N(null, '▶입구-케이블카-남천문-중천문-태항일주-태항천폭-천척장성-불관대-홍석잔도-북고봉-셔틀버스 하산'),
      N(null, '중식 후 한단으로 이동 [약 1시간 20분 소요]', '전용차량'),
      N(null, '▶2600년 역사를 가지고 있는 북방 수성-광부고성'),
      N(null, '석식 후 호텔 투숙 및 휴식'),
      H('한단 영양국제호텔 또는 동급 (5성급)'),
    ],
    hotel: HOTEL_HANDAN,
  },
  {
    day: 5,
    regions: ['한단', '석가장', '청주'],
    meals: meal(true, true, false, '호텔식', '호텔식', null),
    schedule: [
      N(null, '호텔 조식 후 석가장으로 이동 [약 2시간 소요]', '전용차량'),
      N(null, '▶조운묘 관광'),
      N(null, '중식 후 공항으로 이동'),
      F('16:45', 'RF8143 석가장국제공항 출발 → 청주국제공항 19:35 도착', 'RF8143'),
    ],
    hotel: null,
  },
];

// ── 3박4일 (TL-SJW-04-01) — 원문 그대로 ──
// 차이점:
//   D2 보천대협곡: "쌈심플래폼" / "동굴엘리베이터"  (4박5일은 "쌍심" / "동굴엘레베이터")
//   D3 대협곡: 함주→이룡희주 순서 / "환산성일주[전동카]" / "도보 약 60분" (4박5일은 이룡희주→함주 / "환산선 일주[전동카 포함]" / "도보로 약 60분")
//   D3 끝에 광부고성 포함 (4박5일은 D4 에 광부고성)
const DAYS_4D = [
  {
    day: 1,
    regions: ['청주', '석가장', '임주'],
    meals: meal(false, false, true, null, null, '샤브샤브 무제한'),
    schedule: [
      F('14:25', 'RF8133 청주국제공항 출발 → 석가장국제공항 15:45 도착', 'RF8133'),
      N(null, '석가장 국제공항 도착 후 가이드 미팅'),
      N(null, '임주로 이동 [약 4시간 30분 소요]', '전용차량'),
      N(null, '석식 후 호텔 투숙 및 휴식'),
      H('임주 환빈서안호텔 또는 동급 (5성급)'),
    ],
    hotel: HOTEL_LINJU,
  },
  {
    day: 2,
    regions: ['임주', '천계산', '보천대협곡', '임주'],
    meals: meal(true, true, true, '호텔식', '산채비빔밥', '삼겹살 무제한'),
    schedule: [
      N(null, '호텔 조식 후 천계산으로 이동 [약 1시간 30분 소요]'),
      N(null, '▶운봉화랑[전동카 포함]-시담대-여화대-유리잔도'),
      N(null, '중식 후 보천대협곡으로 이동 [약 40분 소요]'),
      N(null, '▶입구-셔틀버스-공중버스-쌈심플래폼-레일케이블카-전동카-유리전망대-전동카-동굴엘리베이터-전동카-셔틀버스-출구'),
      N(null, '임주로 이동 [약 2시간 소요]', '전용차량'),
      N(null, '▶피로를 풀어주는 전신마사지 90분 체험 [매너팁 별도]'),
      N(null, '석식 후 호텔 투숙 및 휴식'),
      H('임주 환빈서안호텔 또는 동급 (5성급)'),
    ],
    hotel: HOTEL_LINJU,
  },
  {
    day: 3,
    regions: ['임주', '대협곡', '한단'],
    meals: meal(true, true, true, '호텔식', '동태찌개', '현지식'),
    schedule: [
      N(null, '호텔 조식 후 대협곡으로 이동 [약 50분 소요]'),
      N(null, '▶도화곡-황룡담-함주-이룡희주-구련폭포[도보 약 60분] -환산성일주[전동카]-천갱-수녀봉-몽환곡'),
      N(null, '중식 후 한단으로 이동 [약 1시간 40분 소요]', '전용차량'),
      N(null, '▶2600년 역사를 가지고 있는 북방 수성-광부고성'),
      N(null, '석식 후 호텔 투숙 및 휴식'),
      H('한단 영양국제호텔 또는 동급 (5성급)'),
    ],
    hotel: HOTEL_HANDAN,
  },
  {
    day: 4,
    regions: ['한단', '석가장', '청주'],
    meals: meal(true, true, false, '호텔식', '호텔식', null),
    schedule: [
      N(null, '호텔 조식 후 석가장으로 이동 [약 2시간 소요]', '전용차량'),
      N(null, '▶조운묘 관광'),
      N(null, '중식 후 공항으로 이동'),
      F('16:45', 'RF8143 석가장국제공항 출발 → 청주국제공항 19:35 도착', 'RF8143'),
    ],
    hotel: null,
  },
];

const META = {
  flight_out: 'RF8133',
  flight_in: 'RF8143',
  ticketing_deadline: null,
  airline: 'RF(에어로케이)',
  departure_airport: '청주(CJJ)',
  seats_note: '전세기',
};

async function fixOne(id, days, label) {
  const { data: rows, error: fetchErr } = await sb
    .from('travel_packages')
    .select('itinerary_data')
    .eq('id', id)
    .limit(1);
  if (fetchErr || !rows?.[0]) {
    console.error(`❌ ${label} fetch 실패:`, fetchErr?.message);
    return false;
  }

  const newItinerary = {
    ...(rows[0].itinerary_data || {}),
    meta: { ...(rows[0].itinerary_data?.meta || META) },
    days,
  };

  const { error: updErr } = await sb
    .from('travel_packages')
    .update({ itinerary_data: newItinerary })
    .eq('id', id);

  if (updErr) {
    console.error(`❌ ${label} UPDATE 실패:`, updErr.message);
    return false;
  }
  console.log(`✅ ${label} (${id}) — itinerary_data.days 원문 충실도 복원 완료`);
  return true;
}

(async () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  원문 충실도 회복 수정 (5개 환각·축약 오류)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const r1 = await fixOne('b58f873b-c64c-4b9c-8c79-b15753bd0aa9', DAYS_4D, 'TL-SJW-04-01 (3박4일)');
  const r2 = await fixOne('4c14954b-ee06-4fb1-9670-a68f243a0a06', DAYS_5D, 'TL-SJW-05-02 (4박5일)');

  if (r1 && r2) {
    console.log('\n✅ 모든 수정 완료. ISR 캐시 갱신 필요 시:');
    console.log('   curl -X POST http://localhost:3000/api/revalidate -H "Content-Type: application/json" \\');
    console.log('        -d \'{"paths":["/packages/b58f873b-c64c-4b9c-8c79-b15753bd0aa9","/packages/4c14954b-ee06-4fb1-9670-a68f243a0a06"],"secret":"$REVALIDATE_SECRET"}\'');
  }
})().catch(err => {
  console.error('❌ 실패:', err);
  process.exit(1);
});
