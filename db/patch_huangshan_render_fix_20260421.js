/**
 * 황산 2건 렌더링 오류 6건 중 데이터 레벨 4건 수정:
 *   1) inclusions "항공료, 택스, 유류세" → 3개 분리
 *   2) flight activity 출발·도착 2개 → 단일 "→" 포맷으로 통합
 *   3) "호텔 체크인 및 휴식" → "호텔 투숙 및 휴식"
 *   5) PKG2 DAY4 "라운드 후 석식 및 호텔 투숙" → "라운드 후 석식" (호텔은 별도 카드)
 *
 * 대상 id:
 *   BA-TXN-04-01: c081a21b-46dc-4d8a-aad8-5c38dce608aa
 *   BA-TXN-05-01: 6496fb7c-ee57-41cb-8646-e7c061aa24eb
 */

const { initSupabase } = require('./templates/insert-template');

const PKG_IDS = [
  'c081a21b-46dc-4d8a-aad8-5c38dce608aa', // BA-TXN-04-01 (3박4일)
  '6496fb7c-ee57-41cb-8646-e7c061aa24eb', // BA-TXN-05-01 (4박5일)
];

// flatten 된 새 inclusions (아이콘 매칭 규칙과 맞춤)
const INCLUSIONS_FLAT = [
  '항공료', '택스', '유류세',
  '호텔',
  '송영차량(단독차량 별도문의)',
  '한국어 가능한 상주직원',
  '무제한 그린피',
  '호텔 조식+석식',
  '여행자보험',
  '김해공항 샌딩',
  '중국연휴 서차지',
];

function fixFirstDayFlights(schedule) {
  // 기대 패턴: [flight(출발), flight(도착), normal, normal, normal]
  if (!Array.isArray(schedule) || schedule.length < 2) return schedule;
  const dep = schedule[0], arr = schedule[1];
  if (dep?.type !== 'flight' || arr?.type !== 'flight') return schedule;
  if (!/출발/.test(dep.activity || '') || !/도착/.test(arr.activity || '')) return schedule;

  // 부산 김해 국제공항 출발 / 황산 툰시 국제공항 도착 → "부산 김해 출발 → 황산 툰시 도착 11:50"
  const depCity = (dep.activity.match(/^(.+?)(?:국제)?공항?\s*출발/) || [])[1]?.trim() || '출발지';
  const arrCity = (arr.activity.match(/^(.+?)(?:국제)?공항?\s*도착/) || [])[1]?.trim() || '도착지';
  const arrTime = arr.time || null;

  const merged = {
    time: dep.time,
    activity: `${depCity} 출발 → ${arrCity} 도착 ${arrTime || ''}`.trim(),
    type: 'flight',
    transport: dep.transport || arr.transport,
    note: null,
  };
  return [merged, ...schedule.slice(2)];
}

function fixLastDayFlights(schedule) {
  // 기대 패턴: [..normal, flight(출발), flight(도착)]
  if (!Array.isArray(schedule) || schedule.length < 2) return schedule;
  const n = schedule.length;
  const dep = schedule[n - 2], arr = schedule[n - 1];
  if (dep?.type !== 'flight' || arr?.type !== 'flight') return schedule;
  if (!/출발/.test(dep.activity || '') || !/도착/.test(arr.activity || '')) return schedule;

  const depCity = (dep.activity.match(/^(.+?)(?:국제)?공항?\s*출발/) || [])[1]?.trim() || '출발지';
  const arrCity = (arr.activity.match(/^(.+?)(?:국제)?공항?\s*도착/) || [])[1]?.trim() || '도착지';
  const arrTime = arr.time || null;

  const merged = {
    time: dep.time,
    activity: `${depCity} 출발 → ${arrCity} 도착 ${arrTime || ''}`.trim(),
    type: 'flight',
    transport: dep.transport || arr.transport,
    note: null,
  };
  return [...schedule.slice(0, n - 2), merged];
}

function normalizeCheckin(schedule) {
  return schedule.map(s => {
    if (s?.type === 'normal' && typeof s.activity === 'string') {
      if (s.activity === '호텔 체크인 및 휴식') {
        return { ...s, activity: '호텔 투숙 및 휴식' };
      }
      if (s.activity === '라운드 후 석식 및 호텔 투숙') {
        return { ...s, activity: '라운드 후 석식' };
      }
    }
    return s;
  });
}

(async () => {
  const sb = initSupabase();

  for (const id of PKG_IDS) {
    const { data: [pkg], error } = await sb
      .from('travel_packages')
      .select('id, short_code, inclusions, itinerary_data')
      .eq('id', id)
      .limit(1);

    if (error || !pkg) {
      console.error(`❌ 조회 실패 ${id}: ${error?.message}`);
      continue;
    }

    const itin = pkg.itinerary_data || {};
    const days = Array.isArray(itin.days) ? itin.days.slice() : [];

    // flight 통합 + 텍스트 정규화
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      if (!d?.schedule) continue;
      let sched = normalizeCheckin(d.schedule);
      if (i === 0) sched = fixFirstDayFlights(sched);
      if (i === days.length - 1) sched = fixLastDayFlights(sched);
      days[i] = { ...d, schedule: sched };
    }

    const newItin = {
      ...itin,
      highlights: {
        ...(itin.highlights || {}),
        inclusions: INCLUSIONS_FLAT,
      },
      days,
    };

    const { error: uerr } = await sb
      .from('travel_packages')
      .update({
        inclusions: INCLUSIONS_FLAT,
        itinerary_data: newItin,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (uerr) {
      console.error(`❌ ${pkg.short_code} UPDATE 실패: ${uerr.message}`);
    } else {
      console.log(`✅ ${pkg.short_code} 데이터 스탬핑 완료 — inclusions=${INCLUSIONS_FLAT.length}개, flight 통합, 체크인/투숙 정규화`);
    }
  }

  console.log('\n✔ DB 패치 완료');
  process.exit(0);
})();
