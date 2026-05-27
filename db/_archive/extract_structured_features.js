/**
 * 상품 구조화 데이터 자동 추출
 * itinerary_data + inclusions + special_notes → structured_features JSONB
 * + mention_count + source_packages 갱신
 */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ── 추출 함수들 ──

function extractBenefits(days) {
  const benefits = [];
  for (const day of days) {
    for (const item of (day.schedule || [])) {
      if (!/\[특전\]|특전\)/.test(item.activity)) continue;
      const name = item.activity.replace(/\[특전\]\s*/g, '').replace(/\(매너팁별도\)/g, '').trim();
      let type = 'other';
      if (/마사지|맛사지|스파/.test(name)) type = 'massage';
      else if (/과일|도시락|선물/.test(name)) type = 'gift';
      else if (/야경|시티투어|야시장|투어/.test(name)) type = 'tour';
      else if (/뷔페|과일뷔페/.test(name)) type = 'food';
      benefits.push({ type, name, day: day.day });
    }
  }
  return benefits;
}

function extractShopping(days, inclusions) {
  let count = 0;
  const items = [];
  const allText = [...(inclusions || []), ...days.flatMap(d => (d.schedule || []).map(s => s.activity))].join(' ');

  // 쇼핑 횟수
  const countMatch = allText.match(/쇼핑\s*(\d+)\s*회|(\d+)\s*회\s*방문|(\d+)군데/);
  if (countMatch) count = parseInt(countMatch[1] || countMatch[2] || countMatch[3]);

  // 쇼핑 품목
  if (/침향/.test(allText)) items.push('침향');
  if (/잡화/.test(allText)) items.push('잡화');
  if (/커피/.test(allText)) items.push('커피');
  if (/라텍스/.test(allText)) items.push('라텍스');
  if (/한약/.test(allText)) items.push('한약방');
  if (/게르마늄/.test(allText)) items.push('게르마늄');
  if (/죽탄/.test(allText)) items.push('죽탄');
  if (/동충하초/.test(allText)) items.push('동충하초');
  if (/면세/.test(allText)) items.push('면세점');
  if (/토산품/.test(allText)) items.push('토산품');

  const noShopping = /노쇼핑|NO쇼핑|no shopping/i.test(allText);

  if (count === 0 && items.length > 0) count = items.length;
  return { count, items, no_shopping: noShopping };
}

function extractMassage(days, inclusions) {
  const allText = [...(inclusions || []), ...days.flatMap(d => (d.schedule || []).map(s => s.activity))].join(' ');
  if (!/마사지|맛사지|머드스파/.test(allText)) return null;

  const included = /\[특전\].*마사지|포함.*마사지|마사지.*포함|마사지.*\[특전\]/.test(allText) || (inclusions || []).some(i => /마사지|맛사지/.test(i));
  const durMatch = allText.match(/마사지\s*(\d+)\s*분|(\d+)\s*분.*마사지/);
  const duration = durMatch ? parseInt(durMatch[1] || durMatch[2]) : null;
  const tipNote = /매너팁|팁별도|팁 별도/.test(allText) ? '매너팁별도' : null;

  return { included, duration, tip_note: tipNote };
}

function extractShows(days) {
  const shows = [];
  for (const day of days) {
    for (const item of (day.schedule || [])) {
      if (/쇼\s|쇼$|공연|관람|오페라|뮤지컬/.test(item.activity) && !/쇼핑/.test(item.activity)) {
        const name = item.activity.replace(/^[▶❥☞★■♥●▷\s]+/, '').replace(/관람.*$/, '').trim();
        if (name.length > 2 && !shows.includes(name)) shows.push(name);
      }
    }
  }
  return shows;
}

function extractSpecialMeals(days) {
  const meals = new Set();
  for (const day of days) {
    const m = day.meals || {};
    for (const note of [m.lunch_note, m.dinner_note].filter(Boolean)) {
      if (/삼겹살|불고기|쌈밥|전골|훠궈|카이세키|돈까스|양꼬치|코스|BBQ|뷔페|스키야키|장어|보쌈|소모듬/.test(note)) {
        meals.add(note.replace(/^(한식|현지식|일식)\s*[\(（]?/, '').replace(/[\)）]\s*$/, '').trim());
      }
    }
  }
  return [...meals];
}

function extractHotelAmenities(days) {
  const amenities = new Set();
  for (const day of days) {
    const note = day.hotel?.note || '';
    if (/대욕장|온천|♨/.test(note)) amenities.add('온천/대욕장');
    if (/노미호다이|주류.*무제한/.test(note)) amenities.add('노미호다이(주류무제한)');
    if (/인피니티/.test(note)) amenities.add('인피니티 온천');
    if (/오션뷰|바다뷰/.test(note)) amenities.add('오션뷰');
    if (/안마의자/.test(note)) amenities.add('안마의자');
    if (/라운지/.test(note)) amenities.add('프리미엄 라운지');
  }
  return [...amenities];
}

function extractGifts(specialNotes) {
  if (!specialNotes) return [];
  const gifts = [];
  if (/마유크림/.test(specialNotes)) gifts.push('마유크림');
  if (/수액파스/.test(specialNotes)) gifts.push('수액파스');
  if (/목베개|라텍스목베개/.test(specialNotes)) gifts.push('라텍스목베개');
  if (/침향.*1알/.test(specialNotes)) gifts.push('침향 하루1알');
  if (/과일바구니/.test(specialNotes)) gifts.push('과일바구니');
  if (/과일\s*도시락/.test(specialNotes)) gifts.push('과일도시락');
  return gifts;
}

// ── 메인 ──

async function main() {
  const { data: pkgs } = await sb.from('travel_packages')
    .select('id, title, itinerary_data, inclusions, excludes, special_notes, product_type')
    .not('itinerary_data', 'is', null);

  console.log('대상 상품:', pkgs.length, '개\n');

  let updated = 0;
  for (const pkg of pkgs) {
    const days = Array.isArray(pkg.itinerary_data) ? pkg.itinerary_data : (pkg.itinerary_data?.days || []);
    if (days.length === 0) continue;

    const features = {
      benefits: extractBenefits(days),
      shopping: extractShopping(days, pkg.inclusions),
      massage: extractMassage(days, pkg.inclusions),
      shows: extractShows(days),
      special_meals: extractSpecialMeals(days),
      hotel_amenities: extractHotelAmenities(days),
      gifts: extractGifts(pkg.special_notes),
      no_tip: /노팁|no tip/i.test(pkg.product_type || ''),
      no_option: /노옵션|no option/i.test(pkg.product_type || ''),
      no_shopping: /노쇼핑|NO쇼핑/i.test(pkg.product_type || ''),
    };

    const { error } = await sb.from('travel_packages').update({ structured_features: features }).eq('id', pkg.id);
    if (!error) updated++;
  }

  console.log('구조화 완료:', updated, '개 상품\n');

  // 결과 샘플 출력
  const { data: samples } = await sb.from('travel_packages')
    .select('title, structured_features')
    .not('structured_features', 'eq', '{}')
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('=== 구조화 샘플 ===');
  samples?.forEach(s => {
    const f = s.structured_features;
    const tags = [];
    if (f.no_tip) tags.push('노팁');
    if (f.no_option) tags.push('노옵션');
    if (f.no_shopping) tags.push('노쇼핑');
    if (f.benefits?.length) tags.push('특전' + f.benefits.length + '종');
    if (f.massage?.included) tags.push('마사지포함(' + f.massage.duration + '분)');
    if (f.shopping?.count) tags.push('쇼핑' + f.shopping.count + '회');
    if (f.shows?.length) tags.push('쇼' + f.shows.length + '개');
    if (f.special_meals?.length) tags.push('특식' + f.special_meals.length + '종');
    if (f.hotel_amenities?.length) tags.push(f.hotel_amenities.join('+'));
    if (f.gifts?.length) tags.push('선물' + f.gifts.length + '종');
    console.log('\n' + s.title.slice(0, 40));
    console.log('  → ' + tags.join(' | '));
  });

  // 전체 통계
  let withBenefits = 0, withMassage = 0, withShows = 0, noTip = 0, noShopping = 0;
  const { data: all } = await sb.from('travel_packages').select('structured_features').not('structured_features', 'eq', '{}');
  all?.forEach(p => {
    const f = p.structured_features;
    if (f.benefits?.length) withBenefits++;
    if (f.massage?.included) withMassage++;
    if (f.shows?.length) withShows++;
    if (f.no_tip) noTip++;
    if (f.no_shopping) noShopping++;
  });

  console.log('\n=== 전체 통계 ===');
  console.log('특전 포함:', withBenefits, '개');
  console.log('마사지 포함:', withMassage, '개');
  console.log('공연/쇼 포함:', withShows, '개');
  console.log('노팁:', noTip, '개');
  console.log('노쇼핑:', noShopping, '개');
}

main().catch(e => console.error(e.message));
