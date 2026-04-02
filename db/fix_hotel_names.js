/**
 * hotel.name 빈 것 채우기
 * 스케줄 텍스트에서 호텔명 추출 또는 같은 목적지 다른 상품에서 복사
 */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// 스케줄 텍스트에서 호텔명 추출
function extractHotelName(schedule) {
  if (!schedule) return null;
  for (const item of schedule) {
    const act = item.activity || '';
    // "XXXX호텔 투숙" / "XXXX리조트 체크인" 패턴
    const m = act.match(/([가-힣A-Za-z\s]+(?:호텔|리조트|Hotel|Resort))/i);
    if (m) return m[1].trim();
    // "HOTEL: XXXX" 패턴
    const h = act.match(/HOTEL\s*[:：]\s*(.+)/i);
    if (h) return h[1].trim();
  }
  return null;
}

async function main() {
  const { data: pkgs } = await sb.from('travel_packages')
    .select('id, title, destination, itinerary_data')
    .not('itinerary_data', 'is', null);

  let fixed = 0;
  let skipped = 0;
  const manual = [];

  // 목적지별 호텔명 수집 (다른 상품에서 호텔명 복사용)
  const hotelByDest = {};
  for (const pkg of pkgs) {
    const days = Array.isArray(pkg.itinerary_data) ? pkg.itinerary_data : (pkg.itinerary_data?.days || []);
    for (const day of days) {
      if (day.hotel?.name && pkg.destination) {
        if (!hotelByDest[pkg.destination]) hotelByDest[pkg.destination] = [];
        hotelByDest[pkg.destination].push(day.hotel.name);
      }
    }
  }

  for (const pkg of pkgs) {
    const it = pkg.itinerary_data;
    const days = Array.isArray(it) ? it : (it?.days || []);
    let changed = false;

    for (const day of days) {
      if (!day.hotel) continue;
      if (day.hotel.name && day.hotel.name.trim() !== '') continue;

      // 1차: 같은 DAY 스케줄에서 호텔명 추출
      let name = extractHotelName(day.schedule);

      // 2차: 같은 목적지 다른 상품에서 호텔명 복사
      if (!name && pkg.destination && hotelByDest[pkg.destination]?.length > 0) {
        name = hotelByDest[pkg.destination][0];
      }

      if (name) {
        day.hotel.name = name;
        changed = true;
        fixed++;
      } else {
        skipped++;
        manual.push({ id: pkg.id, title: (pkg.title || '').slice(0, 30), day: day.day, destination: pkg.destination });
      }
    }

    if (changed) {
      const updateData = Array.isArray(it) ? days : { ...it, days };
      await sb.from('travel_packages').update({ itinerary_data: updateData }).eq('id', pkg.id);
    }
  }

  console.log('hotel.name 채우기 완료:', fixed, '건');
  console.log('채우기 불가 (수동 확인):', skipped, '건');

  if (manual.length > 0) {
    console.log('\n수동 확인 목록:');
    manual.forEach(m => console.log('  ' + m.title + ' DAY' + m.day + ' (' + m.destination + ')'));
  }

  // 검증
  let remaining = 0;
  const { data: verify } = await sb.from('travel_packages').select('itinerary_data').not('itinerary_data', 'is', null);
  for (const pkg of verify) {
    const days = Array.isArray(pkg.itinerary_data) ? pkg.itinerary_data : (pkg.itinerary_data?.days || []);
    for (const day of days) {
      if (day.hotel && (!day.hotel.name || day.hotel.name.trim() === '')) remaining++;
    }
  }
  console.log('\n남은 hotel.name 빈 건:', remaining);
}

main().catch(e => console.error(e.message));
