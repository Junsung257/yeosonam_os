const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log('🔄 다낭 상품 정밀 대조 및 교정 진행중...');

  // 1. 공통 추가 항목 (미성년자 서류 안내)
  const minorNotice = '미성년자(만14세 미만) 동반 시, 영문 가족관계증명서 지참 필수 (미동반 시 영어번역 공증 위임장 추가 필요)';

  // 2. 라이트 상품 교정
  const { data: lightPkgs } = await sb.from('travel_packages').select('id, excludes, notices_parsed, itinerary_data').ilike('title', '%다낭/호이안 노팁/노옵션 3박5일 라이트%').eq('filename', 'discord_auto_input');
  
  if (lightPkgs && lightPkgs.length > 0) {
    const pkg = lightPkgs[0];
    const newNotices = [...pkg.notices_parsed, minorNotice];
    const newDays = pkg.itinerary_data.days;
    // Day 2 보트 추가, Day 3 테마파크 추가
    newDays[1].schedule.splice(2, 0, { time: null, activity: '투본강 보트를 타고 호이안 올드타운으로 이동', type: 'normal', transport: null, note: null });
    newDays[2].schedule[1].note = '케이블카+테마파크자유시간+골든브릿지';

    const newItineraryData = { ...pkg.itinerary_data, days: newDays };

    await sb.from('travel_packages').update({
      notices_parsed: newNotices,
      itinerary_data: newItineraryData
    }).eq('id', pkg.id);
  }

  // 3. 품격 상품 교정
  const { data: premiumPkgs } = await sb.from('travel_packages').select('id, excludes, notices_parsed, itinerary_data').ilike('title', '%다낭/호이안 노팁/노옵션 3박5일 품격%').eq('filename', 'discord_auto_input');
  
  if (premiumPkgs && premiumPkgs.length > 0) {
    const pkg = premiumPkgs[0];
    // Excludes 재조정 (18만원, 4만원으로 변경)
    const newExcludes = pkg.excludes.map(ex => {
      if (ex.includes('싱글차지')) return '싱글차지 전일정 18만원';
      if (ex.includes('불꽃놀이기간')) return '불꽃놀이기간(5/30~7/11 간헐적) 써차지 박당룸당 4만원';
      return ex;
    });
    
    const newNotices = [...pkg.notices_parsed, minorNotice];
    const newDays = pkg.itinerary_data.days;
    newDays[1].schedule.splice(2, 0, { time: null, activity: '투본강 보트를 타고 호이안 올드타운으로 이동', type: 'normal', transport: null, note: null });
    newDays[2].schedule[2].note = '케이블카+테마파크자유시간+골든브릿지';

    // 메타데이터에 싱글차지 텍스트 동기화
    const newItineraryData = { ...pkg.itinerary_data, days: newDays, highlights: { ...pkg.itinerary_data.highlights, excludes: newExcludes } };

    await sb.from('travel_packages').update({
      excludes: newExcludes,
      notices_parsed: newNotices,
      itinerary_data: newItineraryData
    }).eq('id', pkg.id);
  }

  console.log('✅ 대조 결과 누락된 미세 디테일 교정 완료!');
}
main();
