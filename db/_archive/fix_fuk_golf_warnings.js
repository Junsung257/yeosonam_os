/**
 * 나가사키 골프 2건의 audit 경고 3건 자동 수정:
 *  1. price_dates에서 오늘(2026-04-18) 이전 날짜 제거 (17건)
 *  2. itinerary_data.meta 객체 추가 (title/destination/days/airline 등)
 *  3. 콤마 관광지는 신경쓰지 않음 (splitScheduleItems 자동 처리)
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const [k, ...rest] = line.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const IDS = ['2227e9c4-a8ba-464e-b89e-4b901625fa8e', 'e4a2ae42-d00e-484a-ad78-3785c955448b'];
const TODAY = new Date().toISOString().slice(0, 10); // "2026-04-18"

(async () => {
  for (const id of IDS) {
    const { data: pkg } = await sb.from('travel_packages').select('*').eq('id', id).maybeSingle();
    if (!pkg) { console.log(`❌ ${id} 미발견`); continue; }

    // 1. 과거 출발일 제거
    const futureDates = (pkg.price_dates || []).filter(d => d.date >= TODAY);
    const removedCount = (pkg.price_dates || []).length - futureDates.length;

    // 2. itinerary_data.meta 추가
    const days = pkg.itinerary_data?.days || pkg.itinerary_data || [];
    const updatedItinerary = {
      meta: {
        title: pkg.title,
        destination: pkg.destination,
        nights: pkg.nights,
        days: pkg.duration,
        departure_airport: pkg.departure_airport,
        airline: pkg.airline,
        flight_out: 'BX148',
        flight_in: 'BX143',
        departure_days: pkg.departure_days,
        min_participants: pkg.min_participants,
        ticketing_deadline: pkg.ticketing_deadline,
        brand: '여소남',
      },
      highlights: {
        inclusions: pkg.inclusions || [],
        excludes: pkg.excludes || [],
        shopping: '노옵션 & 노쇼핑',
        remarks: ['특별약관 적용', '캐디 불가 (셀프 플레이만)', '2인1실 신관 기준'],
      },
      days: Array.isArray(days) ? days : (days.days || []),
      optional_tours: [],
    };

    const { error } = await sb.from('travel_packages').update({
      price_dates: futureDates,
      itinerary_data: updatedItinerary,
    }).eq('id', id);

    if (error) { console.error(`❌ ${pkg.title}:`, error.message); continue; }
    console.log(`✅ ${pkg.title}`);
    console.log(`   - 과거 출발일 ${removedCount}건 제거 (유효 ${futureDates.length}건)`);
    console.log(`   - itinerary_data.meta 추가 (title/destination/airline/flight_out/flight_in)`);
  }
})().catch(e => { console.error(e); process.exit(1); });
